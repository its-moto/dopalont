import * as THREE from 'three';
import { lerp } from './core/math.js';
import { eyeHeight } from './sim/movement.js';
import { WEAPONS } from './data/weapons.js';
import { blocked } from './sim/combat.js';
import { RULES, REASON_TEXT } from './data/rules.js';
import { TEAM_LABEL } from './net/config.js';
import { createScene, BASE_FOV } from './render/scene.js';
import { buildMapMeshes } from './render/map.js';
import { ViewModel } from './render/viewmodel.js';
import { Effects } from './render/effects.js';
import { TargetViews } from './render/targets.js';
import { PlayerViews } from './render/characters.js';
import { Hud } from './ui/hud.js';
import { Dopamine } from './ui/dopamine.js';
import { Minimap } from './ui/minimap.js';
import { AbilityViews } from './render/abilities.js';

const STEP_DIST = 2.4, STEP_SPEED = 4.4, HEAR_DIST = 45;
const EYE_STAND = 1.62, EYE_CROUCH = 1.05;
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _muzzle = new THREE.Vector3(), _from = new THREE.Vector3();

/** 設置されたスパイク。上の灯りが点滅する */
function buildSpike() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.32), new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.5, metalness: 0.6 }));
  body.position.y = 0.25; body.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff5a3c, emissiveIntensity: 3 }));
  lamp.position.y = 0.56;
  g.add(body, lamp);
  g.visible = false;
  return { g, lamp };
}

/** 購入フェーズ中の見えない壁を、うっすら見えるようにする */
function buildBarrier(zone) {
  const g = new THREE.Group();
  if (!zone) return g;
  const [x0, z0, x1, z1] = zone, h = 3.5;
  const mat = new THREE.MeshBasicMaterial({ color: 0x4fd2ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const wall = (w, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, h / 2, z); m.rotation.y = ry;
    g.add(m);
  };
  wall(x1 - x0, (x0 + x1) / 2, z0, 0); wall(x1 - x0, (x0 + x1) / 2, z1, 0);
  wall(z1 - z0, x0, (z0 + z1) / 2, Math.PI / 2); wall(z1 - z0, x1, (z0 + z1) / 2, Math.PI / 2);
  return g;
}

/**
 * 表示する側。セッション (射撃場 / ホスト / 参加) の状態とイベントを、描画・音・HUD に流す
 * 勝敗に関わる計算はここではしない
 * @param hooks {{onUnlocked:()=>void}} マウスの固定が外れて、メニューを出してほしい時に呼ぶ
 */
export class Game {
  constructor({ renderer, materials, session, input, sfx, audio, settings, buyMenu, hooks }) {
    this.renderer = renderer; this.session = session;
    this.input = input; this.sfx = sfx; this.audio = audio; this.settings = settings;
    this.buyMenu = buyMenu; this.hooks = hooks;
    const world = session.world, me = session.me;
    this.net = session.mode === 'net';
    this.myTeam = session.roster.get(session.myId)?.team ?? null;

    const { scene, camera } = createScene(world.map.size);
    this.scene = scene; this.camera = camera;
    this.mapGroup = buildMapMeshes(world.map, materials);
    scene.add(this.mapGroup);
    this.targets = new TargetViews(scene, world);
    this.players = new PlayerViews(scene);
    this.fx = new Effects(scene);
    this.abilViews = new AbilityViews(scene, this.fx);
    this.flashT = 0; this.flashDur = 1;
    this.vm = new ViewModel();
    this.vmDef = null;
    this.hud = new Hud();
    this.hud.setMode(this.net, this.myTeam);
    this.dopamine = new Dopamine(sfx, settings, this.net ? Infinity : undefined);
    this.minimap = new Minimap(document.getElementById('minimap'), world.map);
    this.spike = buildSpike();
    scene.add(this.spike.g);
    const zones = world.map.def.buyZones || {};
    this.barriers = { attack: buildBarrier(zones.attack), defense: buildBarrier(zones.defense) };
    scene.add(this.barriers.attack, this.barriers.defense);

    this.stats = { shots: 0, hits: 0, kills: 0, hs: 0 };
    this.last = 0; this.running = false; this.time = 0;
    this.visRecoil = { yaw: 0, pitch: 0 };
    this.zoom = 1;
    if (me) { input.yaw = me.yaw; input.pitch = 0; }
    this.prevYaw = input.yaw; this.prevPitch = 0;
    this.view = { x: 0, y: 0, z: 0, yaw: 0 };
    this.steps = new Map(); // 他プレイヤーの足音用: ID → 前回位置と歩いた距離
    this.buyOpen = false;
    this.specIdx = 0; this.prevClick = false;
    this.beepT = 0; this.workT = 0;

    // ホストのタブが裏に回ると描画ループが止まり、全員のゲームが固まってしまう
    // 裏にいる間は Worker のタイマー (ブラウザに間引かれない) で sim だけ進める
    this.ticker = null;
    if (this.net && session.isHost) {
      const src = 'setInterval(() => postMessage(0), 16);';
      this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.ticker.onmessage = () => {
        if (!this.running || !document.hidden) return;
        const now = performance.now();
        session.update(Math.min(0.25, (now - this.last) / 1000), input);
        this.last = now;
        for (const e of session.events) this.onEvent(e); // キルログや復活時の向きを取りこぼさない
      };
    }

    // 音が壁の向こうから来るか (籠らせる判定)
    const ear = [0, 0, 0];
    audio.occluded = (pt) => {
      const c = this.camera.position;
      ear[0] = c.x; ear[1] = c.y; ear[2] = c.z;
      return blocked(world.boxes, ear, pt);
    };

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.setAspect(w / h);
    this.fx.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  start() {
    this.running = true;
    this.hud.show(true);
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  dispose() {
    this.running = false;
    this.audio.occluded = null;
    this.ticker?.terminate();
    this.closeBuy(false, true);
    this.hud.show(false);
    window.removeEventListener('resize', this.onResize);
    this.mapGroup.traverse((o) => o.geometry?.dispose());
    this.renderer.clear();
  }

  // ---- 購入メニュー ----
  canBuy() {
    const p = this.session.me, r = this.session.round;
    return !!p && p.alive && (!r || r.phase === 'buy');
  }

  openBuy() {
    if (!this.canBuy()) { this.sfx.deny(); this.hud.banner('', '購入フェーズ中だけ買えます', '', 1.2); return; }
    this.buyOpen = true;
    this.buyMenu.open(this.session, this.sfx, () => this.closeBuy(true));
    document.exitPointerLock();
  }

  /** relock: 続けてゲームに戻るか (ボタンやキーで閉じた時)。silent: 後始末なので何も出さない */
  closeBuy(relock, silent = false) {
    if (!this.buyOpen) return;
    this.buyOpen = false;
    this.buyMenu.close();
    if (silent) return;
    if (relock) this.input.lock();
    else this.hooks.onUnlocked();
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const { session, input } = this;
    if (input.edges.has('KeyB')) { input.edges.delete('KeyB'); this.openBuy(); } // 次の tick まで残ると何度も開いてしまう
    const click = (input.buttons & 1) !== 0, clicked = click && !this.prevClick;
    this.prevClick = click;

    session.update(dt, input);
    const world = session.world, p = session.me, alive = !!p && p.alive, r = session.round;
    const remotes = session.remotes;

    // 攻守交代で味方と敵が入れ替わる
    const team = session.roster.get(session.myId)?.team ?? null;
    if (team !== this.myTeam) { this.myTeam = team; this.players.clear(); this.hud.setMode(this.net, team); }

    // ---- カメラ ----
    const cam = this.camera;
    let spectating = null;
    if (alive) {
      const k = 1 - Math.exp(-dt * 28);
      this.visRecoil.yaw += (p.recoil.yaw - this.visRecoil.yaw) * k;
      this.visRecoil.pitch += (p.recoil.pitch - this.visRecoil.pitch) * k;
      session.stepOff *= Math.exp(-dt * 14);
      const a = session.alpha, vo = session.viewOffset;
      cam.position.set(
        lerp(p.prev.x, p.pos.x, a) + vo.x,
        lerp(p.prev.y, p.pos.y, a) + eyeHeight(p) + session.stepOff + vo.y,
        lerp(p.prev.z, p.pos.z, a) + vo.z,
      );
      cam.rotation.set(input.pitch + this.visRecoil.pitch, input.yaw + this.visRecoil.yaw, 0);
    } else {
      // やられた後と観戦: 生きている味方の視点を借りる。クリックで切り替え
      const mates = remotes.filter((m) => m.alive && (!p || m.team === this.myTeam));
      if (mates.length) {
        if (clicked) this.specIdx++;
        spectating = mates[this.specIdx % mates.length];
        cam.position.set(spectating.x, spectating.y + lerp(EYE_STAND, EYE_CROUCH, spectating.crouch), spectating.z);
        cam.rotation.set(spectating.pitch, spectating.yaw, 0);
      } else if (p) {
        cam.rotation.set(input.pitch, input.yaw, 0); // 誰もいなければ、やられた場所から見回す
      } else {
        cam.position.set(0, 78, 8); // 上から全体を見る
        cam.rotation.set(-Math.PI / 2 + 0.1, 0, 0);
      }
    }

    const def = alive ? p.weapons[p.slot].def : null;
    const scoped = alive && p.ads && !!def.ads.scope;
    const zoomTarget = alive && p.ads ? def.ads.zoom : 1;
    this.zoom += (zoomTarget - this.zoom) * (1 - Math.exp(-dt * (scoped ? 30 : 16)));
    input.zoom = this.zoom; // ズーム中は感度を下げる
    const fov = (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / this.zoom) * 180) / Math.PI;
    if (Math.abs(fov - cam.fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    cam.getWorldDirection(_fwd);
    this.audio.setListener(cam.position, _fwd);

    // ---- イベントを表示と音へ ----
    for (const e of session.events) this.onEvent(e);

    this.players.sync(remotes, this.myTeam, dt, spectating ? spectating.id : null);
    this.abilViews.sync(session.ents, this.myTeam, dt);
    this.remoteFootsteps(remotes, dt);
    this.targets.update(dt, session.alpha);
    this.fx.update(dt);
    this.dopamine.update(dt);

    if (alive) {
      if (def !== this.vmDef) { this.vm.setWeapon(def, this.vmDef ? Math.min(0.5, def.equipTime * 0.6) : 0); this.vmDef = def; }
      const speed = Math.hypot(p.vel.x, p.vel.z);
      this.vm.update(dt, { speed, onGround: p.onGround, ads: p.ads, dyaw: input.yaw - this.prevYaw, dpitch: input.pitch - this.prevPitch });
    }
    this.prevYaw = input.yaw; this.prevPitch = input.pitch;

    // ---- ラウンドとスパイク ----
    if (r) this.updateRound(dt, r, p, alive, remotes);
    if (this.buyOpen) {
      if (this.canBuy()) this.buyMenu.refresh();
      else this.closeBuy(false);
    }

    // ---- HUD ----
    this.hud.update(dt, p, world, this.stats);
    this.hud.scope(scoped);
    this.hud.abilities(alive ? p : null, world.freeAbilities);
    // 閃光: 真っ白になり、終わりぎわに戻ってくる
    if (this.flashT > 0) this.flashT -= dt;
    this.hud.flash(alive && this.flashT > 0 ? Math.min(1, (this.flashT / this.flashDur) * 2.2) : 0);
    if (this.net) {
      this.hud.death(!!p && !p.alive, spectating ? `観戦中: ${spectating.name}　(クリックで切り替え)` : '次のラウンドを待っています');
      this.hud.scoreboard(input.keys.has('Tab'), dt, session.roster, session.myId);
    }
    let view = null;
    if (alive) { view = this.view; view.x = cam.position.x; view.y = p.pos.y; view.z = cam.position.z; view.yaw = input.yaw; }
    else if (spectating) { view = this.view; view.x = spectating.x; view.y = spectating.y; view.z = spectating.z; view.yaw = spectating.yaw; }
    this.minimap.update(dt, view, this.myTeam, remotes, world.targets, world.boxes, r ? r.spike : null);

    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (alive && !scoped) this.vm.render(this.renderer);
  }

  updateRound(dt, r, p, alive, remotes) {
    const s = r.spike, hud = this.hud, myId = this.session.myId;

    // 生存者数
    let aAlive = 0, dAlive = 0;
    for (const m of remotes) if (m.alive) { if (m.team === 'attack') aAlive++; else if (m.team === 'defense') dAlive++; }
    if (alive) { if (p.team === 'attack') aAlive++; else dAlive++; }
    hud.round(r, aAlive, dAlive);
    hud.credits(p ? p.credits : null);

    // 設置されたスパイクと警告音
    const g = this.spike.g, onGround = s.state === 'planted' || s.state === 'dropped';
    g.visible = onGround;
    if (onGround) {
      g.position.set(s.x, s.y, s.z);
      g.rotation.z = s.state === 'dropped' ? 1.2 : 0; // 落ちている時は倒れている
      this.spike.lamp.material.emissiveIntensity = s.state === 'planted' && Math.floor(this.time * 4) % 2 ? 5 : 0.6;
    }
    if (r.phase === 'planted') {
      this.beepT -= dt;
      if (this.beepT <= 0) {
        this.beepT = r.timer > 20 ? 1 : r.timer > 10 ? 0.5 : r.timer > 5 ? 0.25 : 0.125; // 爆発が近いほど速く
        this.sfx.spikeBeep([s.x, s.y + 0.5, s.z], r.timer <= 10);
      }
    }

    // 設置・解除の進み具合
    const planting = s.user && s.state === 'carried', defusing = s.user && s.state === 'planted';
    if (planting || defusing) {
      hud.progress(planting ? 'スパイク設置中' : 'スパイク解除中', planting ? s.plant / RULES.plantTime : s.defuse / RULES.defuseTime);
      this.workT -= dt;
      if (this.workT <= 0) {
        this.workT = 0.45;
        const u = s.user === myId ? p.pos : remotes.find((m) => m.id === s.user);
        if (u) this.sfx.spikeWork([u.x, u.y + 0.5, u.z], defusing);
      }
    } else {
      hud.progress('', null);
    }

    // 何ができるかの案内
    let tip = '';
    if (alive && r.phase === 'buy') tip = 'B で購入メニュー';
    else if (alive && s.carrier === myId && r.phase === 'live') tip = this.inSite(p) ? 'F 長押しでスパイク設置' : 'スパイクを持っています (サイトで設置)';
    else if (alive && p.team === 'defense' && s.state === 'planted' && r.phase === 'planted'
      && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) <= RULES.defuseRange) tip = 'F 長押しでスパイク解除';
    hud.status(planting || defusing ? '' : tip);

    for (const side of ['attack', 'defense']) this.barriers[side].visible = r.phase === 'buy';
  }

  inSite(p) {
    const sites = this.session.world.map.sites;
    for (const name in sites) {
      const s = sites[name];
      if (p.pos.x >= s.min[0] && p.pos.x <= s.max[0] && p.pos.z >= s.min[1] && p.pos.z <= s.max[1]) return true;
    }
    return false;
  }

  /** 他プレイヤーの足音は、動きから手元で作る (通信量を増やさない) */
  remoteFootsteps(remotes, dt) {
    const cam = this.camera.position;
    for (const r of remotes) {
      let s = this.steps.get(r.id);
      if (!s) this.steps.set(r.id, (s = { x: r.x, z: r.z, dist: 0 }));
      const d = Math.hypot(r.x - s.x, r.z - s.z);
      s.x = r.x; s.z = r.z;
      const speed = d / Math.max(dt, 1e-3);
      if (!r.alive || !r.onGround || speed < STEP_SPEED || speed > 12) { if (speed < 0.5) s.dist = STEP_DIST * 0.6; continue; }
      s.dist += d;
      if (s.dist < STEP_DIST) continue;
      s.dist = 0;
      if (Math.hypot(r.x - cam.x, r.z - cam.z) < HEAR_DIST) this.sfx.footstep(this.groundMat(r.x, r.y, r.z), [r.x, r.y, r.z]);
    }
  }

  /** その位置の足元の素材 */
  groundMat(x, y, z) {
    let best = 'sand', top = -Infinity;
    for (const b of this.session.world.boxes) {
      if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue;
      if (b.max[1] <= y + 0.1 && b.max[1] > top) { top = b.max[1]; best = b.mat; }
    }
    return best;
  }

  /** 銃口のおおよその位置 (トレーサーの始点) */
  muzzleWorld() {
    const cam = this.camera, ads = this.session.me.ads;
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    return _muzzle.copy(cam.position)
      .addScaledVector(_fwd, 0.9)
      .addScaledVector(_right, ads ? 0 : 0.16)
      .addScaledVector(_up, ads ? -0.06 : -0.13);
  }

  /** キルログ用: 名前と、自分から見て味方かどうか */
  label(id) {
    if (id == null) return { name: 'スパイク', ally: false };
    const r = this.session.roster.get(id);
    if (!r) return { name: id.startsWith('t') ? '的' : '?', ally: false };
    return { name: r.name, ally: id === this.session.myId || (!!this.myTeam && r.team === this.myTeam) };
  }

  /** 光の粒を球状に散らす (アビリティの発動や破裂) */
  burst(at, color, count, speed) {
    const rnd = () => Math.random() - 0.5;
    for (let i = 0; i < count; i++) {
      this.fx.particle(at[0], at[1], at[2], rnd() * speed, rnd() * speed + 1, rnd() * speed, color[0], color[1], color[2], 1, 0.06 + Math.random() * 0.08, 0.3 + Math.random() * 0.4, 4);
    }
  }

  /** 爆発: 火の粉と煙をまき散らす */
  explode(x, y, z) {
    const rnd = () => Math.random() - 0.5;
    for (let i = 0; i < 260; i++) {
      const sp = 6 + Math.random() * 26, hot = i % 3 !== 0;
      this.fx.particle(x, y + 0.5, z, rnd() * sp, Math.random() * sp * 0.7, rnd() * sp,
        hot ? 4 : 0.35, hot ? 1.8 : 0.33, hot ? 0.4 : 0.3, 1, hot ? 0.3 : 1.4, 0.8 + Math.random() * 1.4, hot ? 8 : 1);
    }
    this.sfx.explosion([x, y, z]);
  }

  onEvent(e) {
    const { sfx, fx, vm, hud, session } = this;
    const myId = session.myId, mine = e.playerId === myId;
    switch (e.type) {
      case 'shot': {
        const def = WEAPONS[e.weapon];
        let from;
        if (mine) {
          this.stats.shots++;
          vm.onShot(def);
          sfx.gunshot(def.sound);
          if (!def.melee) fx.muzzleLight(this.camera.position);
          from = this.muzzleWorld();
        } else {
          sfx.gunshot(def.sound, e.origin);
          from = _from.set(e.origin[0], e.origin[1] - 0.15, e.origin[2]);
        }
        if (def.melee) break; // ナイフは弾痕も弾道もなし
        for (const imp of e.impacts) {
          if (!def.noTracer || mine) fx.tracer(from, imp.point);
          if (imp.kind === 'wall') { fx.impact(imp.point, imp.normal, imp.mat); sfx.impact(imp.point, imp.mat); }
        }
        break;
      }
      case 'hit':
        fx.hitSpark(e.point, e.part === 'head');
        this.targets.onHit(e.victimId);
        this.players.onHit(e.victimId);
        if (mine) {
          this.stats.hits++;
          hud.hitmarker(e.part, e.killed);
          hud.damageNumber(e.point, e.damage, e.part, this.camera);
          sfx.hit(e.part);
        }
        if (e.victimId === myId) { hud.hurt(); sfx.hurt(); }
        break;
      case 'kill':
        this.targets.onKill(e.victimId);
        if (this.net) hud.killfeed(this.label(e.playerId), this.label(e.victimId), e.headshot, mine);
        if (mine) {
          this.stats.kills++;
          if (e.headshot) this.stats.hs++;
          this.dopamine.kill(e);
        }
        if (e.victimId === myId) { this.dopamine.reset(); sfx.cancelReload(); sfx.death(); this.specIdx = 0; }
        break;
      case 'respawn':
        if (mine) {
          this.input.yaw = e.yaw; this.input.pitch = 0;
          this.prevYaw = e.yaw; this.prevPitch = 0;
          this.visRecoil.yaw = this.visRecoil.pitch = 0;
          this.vmDef = null;
        }
        break;
      // ---- アビリティ ----
      case 'ability': sfx.ability(e.kind, e.key, mine ? null : [e.x, e.y, e.z]); break;
      case 'effect': {
        const at = [e.x, e.y, e.z];
        sfx.effect(e.kind, at);
        if (e.kind === 'blast' || e.kind === 'iceBreak') this.burst(at, e.kind === 'blast' ? [1.2, 2.4, 4] : [1.6, 2.2, 2.6], 60, 12);
        else if (e.kind === 'heal' || e.kind === 'revive' || e.kind === 'recall' || e.kind === 'orb') this.burst(at, e.kind === 'heal' ? [0.6, 3, 1.4] : [1.4, 2.4, 3.4], 40, 5);
        else if (e.kind === 'flash') this.burst(at, [4, 4, 4], 30, 14);
        break;
      }
      case 'flashed':
        if (e.victimId === myId) { this.flashT = this.flashDur = e.dur; sfx.flashRing(e.dur); }
        break;
      case 'ultReady': if (mine) { hud.banner('', 'アルティメット準備完了 (X)', 'go', 1.8); sfx.ultReady(); } break;

      case 'join': hud.notice(`${e.player.name} が参加しました`); break;
      case 'left': hud.notice('プレイヤーが退出しました'); this.steps.delete(e.playerId); break;
      case 'targetRespawn': this.targets.onRespawn(e.targetId); break;

      // ---- ラウンド ----
      case 'roundStart':
        this.dopamine.reset();
        hud.banner(`ラウンド ${e.n}`, '購入フェーズ', '', 3);
        break;
      case 'phase': hud.banner('戦闘開始', '', 'go', 1.6); sfx.roundGo(); break;
      case 'plant': hud.banner(`スパイク設置 (${e.site})`, this.myTeam === 'defense' ? '解除しろ' : '守りきれ', 'warn', 2.6); sfx.planted(); this.beepT = 0; break;
      case 'explode': this.explode(e.x, e.y, e.z); break;
      case 'spikeDrop': if (this.myTeam === 'attack') hud.notice('スパイクが落ちた'); break;
      case 'spikePickup': if (this.myTeam === 'attack') hud.notice(`${this.label(e.playerId).name} がスパイクを拾った`); break;
      case 'roundEnd': {
        const reason = REASON_TEXT[e.reason] || '';
        if (this.myTeam !== 'attack' && this.myTeam !== 'defense') hud.banner(`${TEAM_LABEL[e.winner]}の勝ち`, reason, '', 5);
        else if (e.winner === this.myTeam) { hud.banner('ラウンド勝利', reason, 'win', 5); sfx.roundWin(); }
        else { hud.banner('ラウンド敗北', reason, 'lose', 5); sfx.roundLose(); }
        break;
      }
      case 'matchEnd': {
        const score = `${e.score.attack} - ${e.score.defense}`;
        const tail = session.isHost ? 'Esc メニューからロビーに戻れます' : 'ホストがロビーに戻すのを待っています';
        if (e.winner === this.myTeam) { hud.banner('勝利!!', `${score}　${tail}`, 'win', 0); sfx.ace(this.audio.now + 0.1); this.dopamine.confetti(140); }
        else if (this.myTeam === 'attack' || this.myTeam === 'defense') { hud.banner('敗北…', `${score}　${tail}`, 'lose', 0); sfx.roundLose(); }
        else hud.banner(`${TEAM_LABEL[e.winner]}の勝ち`, `${score}　${tail}`, '', 0);
        break;
      }

      // ---- ここから下は自分のぶんだけ鳴らす ----
      case 'reloadStart': if (mine) { vm.onReload(e.dur); sfx.reload(e.dur); } break;
      case 'equip': if (mine) { sfx.cancelReload(); sfx.equip(); } break;
      case 'dry': if (mine) sfx.dry(); break;
      case 'footstep': if (mine) sfx.footstep(e.mat); break;
      case 'jump': if (mine) sfx.jump(); break;
      case 'land': if (mine) sfx.land(e.mat); break;
    }
  }
}
