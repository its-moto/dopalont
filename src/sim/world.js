import { mulberry32 } from '../core/math.js';
import { buildMap } from './map.js';
import { stepMovement } from './movement.js';
import { stepCombat, createLoadout } from './combat.js';

export const TICK = 1 / 64;

const NEUTRAL = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, slot: null, yaw: 0, pitch: 0 };

/** ゲームの状態全体。描画・音・DOM に依存しない (Node でも動く) */
export class World {
  constructor(mapDef, opts = {}) {
    this.map = buildMap(mapDef);
    this.boxes = this.map.boxes;
    this.time = 0;
    this.tick = 0;
    this.rng = mulberry32(opts.seed ?? 1);
    this.infiniteReserve = !!opts.infiniteReserve;
    this.players = new Map();
    this.targets = (mapDef.targets || []).map((t, i) => ({
      id: 't' + i,
      pos: { x: t.x, y: 0, z: t.z },
      prev: { x: t.x, y: 0, z: t.z },
      base: { x: t.x, z: t.z },
      move: t.move || null,
      off: 0, dir: 1,
      maxArmor: t.armor || 0,
      hp: 100, armor: t.armor || 0,
      alive: true, respawnAt: 0,
    }));
    this.events = [];
  }

  addPlayer(id, { x = 0, z = 0, yaw = 0, loadout = { primary: 'ar_tap', sidearm: 'pistol_basic' } } = {}) {
    const p = {
      id,
      pos: { x, y: 0, z }, prev: { x, y: 0, z },
      vel: { x: 0, y: 0, z: 0 },
      yaw, pitch: 0, crouch: 0, onGround: false, groundMat: 'sand', stepDist: 0, moveMul: 1,
      hp: 100, armor: 0,
      weapons: createLoadout(loadout),
      slot: 'primary', equipUntil: 0,
      recoil: { yaw: 0, pitch: 0 }, sprayIndex: 0, lastShotTime: -10,
      ads: false, prevFire: false, prevAlt: false, fireBuffer: 0,
    };
    this.players.set(id, p);
    return p;
  }

  emit(type, data) {
    data.type = type;
    this.events.push(data);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** 描画の補間用に、動かす前の位置を覚えておく */
  savePrev() {
    for (const p of this.players.values()) { p.prev.x = p.pos.x; p.prev.y = p.pos.y; p.prev.z = p.pos.z; }
    for (const t of this.targets) { t.prev.x = t.pos.x; t.prev.z = t.pos.z; }
  }

  step(dt, inputs) {
    this.time += dt;
    this.tick++;
    for (const p of this.players.values()) {
      const inp = inputs[p.id] || NEUTRAL;
      stepMovement(this, p, inp, dt);
      stepCombat(this, p, inp, dt);
    }
    for (const t of this.targets) {
      if (!t.alive) {
        if (this.time >= t.respawnAt) {
          t.alive = true; t.hp = 100; t.armor = t.maxArmor;
          this.emit('targetRespawn', { targetId: t.id });
        }
        continue;
      }
      if (t.move) {
        t.off += t.dir * t.move.speed * dt;
        if (Math.abs(t.off) > t.move.range) { t.off = Math.sign(t.off) * t.move.range; t.dir = -t.dir; }
        t.pos[t.move.axis] = t.base[t.move.axis] + t.off;
      }
    }
  }
}
