import * as THREE from 'three';
import { lerp } from './core/math.js';
import { World, TICK } from './sim/world.js';
import { eyeHeight } from './sim/movement.js';
import { WEAPONS } from './data/weapons.js';
import { createRenderer, createScene, BASE_FOV } from './render/scene.js';
import { buildMapMeshes } from './render/map.js';
import { ViewModel } from './render/viewmodel.js';
import { Effects } from './render/effects.js';
import { TargetViews } from './render/targets.js';
import { Hud } from './ui/hud.js';
import { Dopamine } from './ui/dopamine.js';

const ME = 'me';
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _muzzle = new THREE.Vector3();

/**
 * 射撃場 (1 人用)。sim を動かし、その状態とイベントを描画・音・HUD に流す
 * Phase 2 で sim はホスト側に移り、ここは「表示する側」になる
 */
export class Game {
  constructor({ canvas, mapDef, materials, input, sfx, audio, settings }) {
    this.input = input; this.sfx = sfx; this.audio = audio; this.settings = settings;

    this.world = new World(mapDef, { seed: (Math.random() * 1e9) | 0, infiniteReserve: true });
    const sp = mapDef.rangeSpawn;
    this.player = this.world.addPlayer(ME, sp);
    input.yaw = sp.yaw; input.pitch = 0;

    this.renderer = createRenderer(canvas);
    const { scene, camera } = createScene(this.world.map.size);
    this.scene = scene; this.camera = camera;
    scene.add(buildMapMeshes(this.world.map, materials));
    this.targets = new TargetViews(scene, this.world);
    this.fx = new Effects(scene);
    this.vm = new ViewModel();
    this.vm.setWeapon(this.player.weapons[this.player.slot].def);
    this.hud = new Hud();
    this.dopamine = new Dopamine(sfx, settings);

    this.stats = { shots: 0, hits: 0, kills: 0, hs: 0 };
    this.acc = 0; this.last = 0;
    this.stepOff = 0;                 // 段差を上った時のカメラの跳ねをならす
    this.visRecoil = { yaw: 0, pitch: 0 };
    this.zoom = 1;
    this.prevYaw = sp.yaw; this.prevPitch = 0;

    window.addEventListener('resize', () => this.resize());
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
    this.hud.show(true);
    this.last = performance.now();
    const loop = (now) => { this.frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { world, player: p, input } = this;

    this.acc += dt;
    while (this.acc >= TICK) {
      const wasGround = p.onGround, y0 = p.pos.y;
      world.savePrev();
      world.step(TICK, { [ME]: input.sample() });
      input.consumeEdges();
      if (wasGround && p.onGround && Math.abs(p.pos.y - y0) > 0.02) this.stepOff -= p.pos.y - y0;
      this.acc -= TICK;
    }
    const alpha = this.acc / TICK;

    // ---- カメラ ----
    const k = 1 - Math.exp(-dt * 28);
    this.visRecoil.yaw += (p.recoil.yaw - this.visRecoil.yaw) * k;
    this.visRecoil.pitch += (p.recoil.pitch - this.visRecoil.pitch) * k;
    this.stepOff *= Math.exp(-dt * 14);
    const cam = this.camera;
    cam.position.set(
      lerp(p.prev.x, p.pos.x, alpha),
      lerp(p.prev.y, p.pos.y, alpha) + eyeHeight(p) + this.stepOff,
      lerp(p.prev.z, p.pos.z, alpha),
    );
    cam.rotation.set(input.pitch + this.visRecoil.pitch, input.yaw + this.visRecoil.yaw, 0);

    const def = p.weapons[p.slot].def;
    const zoomTarget = p.ads ? def.ads.zoom : 1;
    this.zoom += (zoomTarget - this.zoom) * (1 - Math.exp(-dt * 16));
    input.zoom = this.zoom; // ズーム中は感度を下げる
    const fov = (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / this.zoom) * 180) / Math.PI;
    if (Math.abs(fov - cam.fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    cam.getWorldDirection(_fwd);
    this.audio.setListener(cam.position, _fwd);

    // ---- sim のイベントを表示と音へ ----
    for (const e of world.drainEvents()) this.onEvent(e);

    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.vm.update(dt, { speed, onGround: p.onGround, ads: p.ads, dyaw: input.yaw - this.prevYaw, dpitch: input.pitch - this.prevPitch });
    this.prevYaw = input.yaw; this.prevPitch = input.pitch;
    this.targets.update(dt, alpha);
    this.fx.update(dt);
    this.dopamine.update(dt);
    this.hud.update(dt, p, world, this.stats);

    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.vm.render(this.renderer);
  }

  /** 銃口のおおよその位置 (トレーサーの始点) */
  muzzleWorld() {
    const cam = this.camera, ads = this.player.ads;
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    return _muzzle.copy(cam.position)
      .addScaledVector(_fwd, 0.9)
      .addScaledVector(_right, ads ? 0 : 0.16)
      .addScaledVector(_up, ads ? -0.06 : -0.13);
  }

  onEvent(e) {
    const { sfx, fx, vm, hud } = this;
    switch (e.type) {
      case 'shot': {
        const def = WEAPONS[e.weapon];
        this.stats.shots++;
        vm.onShot(def);
        sfx.gunshot(def.sound);
        fx.muzzleLight(this.camera.position);
        const mz = this.muzzleWorld();
        for (const imp of e.impacts) {
          fx.tracer(mz, imp.point);
          if (imp.kind === 'wall') { fx.impact(imp.point, imp.normal, imp.mat); sfx.impact(imp.point, imp.mat); }
        }
        break;
      }
      case 'hit':
        this.stats.hits++;
        hud.hitmarker(e.part, e.killed);
        hud.damageNumber(e.point, e.damage, e.part, this.camera);
        sfx.hit(e.part);
        fx.hitSpark(e.point, e.part === 'head');
        this.targets.onHit(e.targetId);
        break;
      case 'kill':
        this.stats.kills++;
        if (e.headshot) this.stats.hs++;
        this.targets.onKill(e.targetId);
        this.dopamine.kill(e);
        break;
      case 'targetRespawn': this.targets.onRespawn(e.targetId); break;
      case 'reloadStart': vm.onReload(e.dur); sfx.reload(e.dur); break;
      case 'equip': vm.setWeapon(WEAPONS[e.weapon], e.dur); sfx.cancelReload(); sfx.equip(); break;
      case 'dry': sfx.dry(); break;
      case 'footstep': sfx.footstep(e.mat); break;
      case 'jump': sfx.jump(); break;
      case 'land': sfx.land(e.mat); break;
    }
  }
}
