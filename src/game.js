import * as THREE from 'three';
import { lerp } from './core/math.js';
import { eyeHeight } from './sim/movement.js';
import { RESPAWN_TIME } from './sim/world.js';
import { WEAPONS } from './data/weapons.js';
import { createScene, BASE_FOV } from './render/scene.js';
import { buildMapMeshes } from './render/map.js';
import { ViewModel } from './render/viewmodel.js';
import { Effects } from './render/effects.js';
import { TargetViews } from './render/targets.js';
import { PlayerViews } from './render/characters.js';
import { Hud } from './ui/hud.js';
import { Dopamine } from './ui/dopamine.js';
import { Minimap } from './ui/minimap.js';

const STEP_DIST = 2.4, STEP_SPEED = 4.4, HEAR_DIST = 45;
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _muzzle = new THREE.Vector3(), _from = new THREE.Vector3();

/**
 * 表示する側。セッション (射撃場 / ホスト / 参加) の状態とイベントを、描画・音・HUD に流す
 * 勝敗に関わる計算はここではしない
 */
export class Game {
  constructor({ renderer, materials, session, input, sfx, audio, settings }) {
    this.renderer = renderer; this.session = session;
    this.input = input; this.sfx = sfx; this.audio = audio; this.settings = settings;
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
    this.vm = new ViewModel();
    if (me) this.vm.setWeapon(me.weapons[me.slot].def);
    this.hud = new Hud();
    this.hud.setMode(this.net, this.myTeam);
    this.dopamine = new Dopamine(sfx, settings, this.net ? Infinity : undefined);
    this.minimap = new Minimap(document.getElementById('minimap'), world.map);

    this.stats = { shots: 0, hits: 0, kills: 0, hs: 0 };
    this.last = 0; this.running = false;
    this.visRecoil = { yaw: 0, pitch: 0 };
    this.zoom = 1;
    if (me) { input.yaw = me.yaw; input.pitch = 0; }
    this.prevYaw = input.yaw; this.prevPitch = 0;
    this.view = { x: 0, y: 0, z: 0, yaw: 0 };
    this.steps = new Map(); // 他プレイヤーの足音用: ID → 前回位置と歩いた距離
    this.respawnIn = 0;

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
    this.ticker?.terminate();
    this.hud.show(false);
    window.removeEventListener('resize', this.onResize);
    this.mapGroup.traverse((o) => o.geometry?.dispose());
    this.renderer.clear();
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { session, input } = this;
    session.update(dt, input);
    const world = session.world, p = session.me, alive = !!p && p.alive;

    // ---- カメラ ----
    const cam = this.camera;
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
    } else if (p) {
      cam.rotation.set(input.pitch, input.yaw, 0); // やられた場所から見回せる
    } else {
      cam.position.set(0, 78, 8); // 観戦: 上から全体を見る
      cam.rotation.set(-Math.PI / 2 + 0.1, 0, 0);
    }

    const def = alive ? p.weapons[p.slot].def : null;
    const zoomTarget = alive && p.ads ? def.ads.zoom : 1;
    this.zoom += (zoomTarget - this.zoom) * (1 - Math.exp(-dt * 16));
    input.zoom = this.zoom; // ズーム中は感度を下げる
    const fov = (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / this.zoom) * 180) / Math.PI;
    if (Math.abs(fov - cam.fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    cam.getWorldDirection(_fwd);
    this.audio.setListener(cam.position, _fwd);

    // ---- イベントを表示と音へ ----
    for (const e of session.events) this.onEvent(e);

    const remotes = session.remotes;
    this.players.sync(remotes, this.myTeam, dt);
    this.remoteFootsteps(remotes, dt);
    this.targets.update(dt, session.alpha);
    this.fx.update(dt);
    this.dopamine.update(dt);

    if (alive) {
      const speed = Math.hypot(p.vel.x, p.vel.z);
      this.vm.update(dt, { speed, onGround: p.onGround, ads: p.ads, dyaw: input.yaw - this.prevYaw, dpitch: input.pitch - this.prevPitch });
    }
    this.prevYaw = input.yaw; this.prevPitch = input.pitch;

    // ---- HUD ----
    this.hud.update(dt, p, world, this.stats);
    this.respawnIn = Math.max(0, this.respawnIn - dt);
    this.hud.death(!!p && !p.alive && this.net, this.respawnIn);
    if (this.net) {
      let a = 0, d = 0;
      for (const r of session.roster.values()) { if (r.team === 'attack') a += r.kills; else if (r.team === 'defense') d += r.kills; }
      this.hud.score(a, d);
      this.hud.scoreboard(input.keys.has('Tab'), dt, session.roster, session.myId);
    }
    let view = null;
    if (p) { view = this.view; view.x = cam.position.x; view.y = p.pos.y; view.z = cam.position.z; view.yaw = input.yaw; }
    this.minimap.update(dt, alive ? view : null, this.myTeam, remotes, world.targets, world.boxes);

    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (alive) this.vm.render(this.renderer);
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
    const r = this.session.roster.get(id);
    if (!r) return { name: id.startsWith('t') ? '的' : '?', ally: false };
    return { name: r.name, ally: id === this.session.myId || (!!this.myTeam && r.team === this.myTeam) };
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
          fx.muzzleLight(this.camera.position);
          from = this.muzzleWorld();
        } else {
          sfx.gunshot(def.sound, e.origin);
          from = _from.set(e.origin[0], e.origin[1] - 0.15, e.origin[2]);
        }
        for (const imp of e.impacts) {
          fx.tracer(from, imp.point);
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
        if (e.victimId === myId) { this.respawnIn = RESPAWN_TIME; this.dopamine.reset(); sfx.cancelReload(); sfx.death(); }
        break;
      case 'respawn':
        if (mine) {
          this.input.yaw = e.yaw; this.input.pitch = 0;
          this.prevYaw = e.yaw; this.prevPitch = 0;
          this.visRecoil.yaw = this.visRecoil.pitch = 0;
          vm.setWeapon(WEAPONS[session.me.loadout.primary], 0.4);
        }
        break;
      case 'join': hud.notice(`${e.player.name} が参加しました`); break;
      case 'left': hud.notice('プレイヤーが退出しました'); this.steps.delete(e.playerId); break;
      case 'targetRespawn': this.targets.onRespawn(e.targetId); break;
      // ここから下は自分のぶんだけ鳴らす
      case 'reloadStart': if (mine) { vm.onReload(e.dur); sfx.reload(e.dur); } break;
      case 'equip': if (mine) { vm.setWeapon(WEAPONS[e.weapon], e.dur); sfx.cancelReload(); sfx.equip(); } break;
      case 'dry': if (mine) sfx.dry(); break;
      case 'footstep': if (mine) sfx.footstep(e.mat); break;
      case 'jump': if (mine) sfx.jump(); break;
      case 'land': if (mine) sfx.land(e.mat); break;
    }
  }
}
