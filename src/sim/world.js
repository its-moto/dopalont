import { mulberry32 } from '../core/math.js';
import { buildMap } from './map.js';
import { stepMovement } from './movement.js';
import { stepCombat, createLoadout } from './combat.js';

export const TICK = 1 / 64;
export const RESPAWN_TIME = 3;       // Phase 2 の仮ルール (チームデスマッチ)。Phase 3 でラウンド制に置き換える
const HIST = 64;                     // ラグ補償用に過去 1 秒ぶんの位置を持つ
const HIST_STRIDE = 5;               // time, x, y, z, crouch
const DEFAULT_LOADOUT = { primary: 'ar_tap', sidearm: 'pistol_basic' };

const NEUTRAL = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, slot: null, yaw: 0, pitch: 0, seq: 0 };

/** ゲームの状態全体。描画・音・DOM に依存しない (Node でも動く) */
export class World {
  /**
   * @param opts {{seed?:number, infiniteReserve?:boolean, targets?:boolean, respawn?:boolean}}
   *   targets: 射撃場の的を置くか。respawn: 死んだプレイヤーを自動で復活させるか
   */
  constructor(mapDef, opts = {}) {
    this.map = buildMap(mapDef);
    this.boxes = this.map.boxes;
    this.time = 0;
    this.tick = 0;
    this.rng = mulberry32(opts.seed ?? 1);
    this.infiniteReserve = !!opts.infiniteReserve;
    this.respawn = !!opts.respawn;
    this.muted = false; // true の間はイベントを出さない (クライアントの再計算用)
    this.players = new Map();
    this.targets = opts.targets === false ? [] : (mapDef.targets || []).map((t, i) => ({
      id: 't' + i, isTarget: true,
      pos: { x: t.x, y: t.y || 0, z: t.z },
      prev: { x: t.x, y: t.y || 0, z: t.z },
      base: { x: t.x, z: t.z },
      move: t.move || null,
      off: 0, dir: 1,
      maxArmor: t.armor || 0,
      hp: 100, armor: t.armor || 0,
      alive: true, respawnAt: 0,
    }));
    this.events = [];
  }

  addPlayer(id, { x = 0, z = 0, yaw = 0, team = null, name = '', loadout = DEFAULT_LOADOUT } = {}) {
    const p = {
      id, name, team,
      pos: { x, y: 0, z }, prev: { x, y: 0, z },
      vel: { x: 0, y: 0, z: 0 },
      yaw, pitch: 0, crouch: 0, onGround: false, groundMat: 'sand', stepDist: 0, moveMul: 1,
      hp: 100, armor: 0, alive: true, respawnAt: 0, kills: 0, deaths: 0,
      weapons: createLoadout(loadout), loadout,
      slot: 'primary', equipUntil: 0,
      recoil: { yaw: 0, pitch: 0 }, sprayIndex: 0, lastShotTime: -10,
      ads: false, prevFire: false, prevAlt: false, fireBuffer: 0,
      lastCmd: { ...NEUTRAL, yaw }, ack: 0,
      lagComp: 0, hist: new Float32Array(HIST * HIST_STRIDE), histN: 0,
    };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) { this.players.delete(id); }

  /** チームのスポーン地点に (再) 出現させる */
  spawn(p) {
    const pts = this.map.spawns[p.team] || this.map.spawns.attack;
    const s = pts[Math.floor(this.rng() * pts.length)];
    p.pos.x = s.x + (this.rng() - 0.5) * 2; p.pos.y = 0; p.pos.z = s.z + (this.rng() - 0.5) * 2;
    p.prev.x = p.pos.x; p.prev.y = 0; p.prev.z = p.pos.z;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.yaw = p.team === 'defense' ? Math.PI : 0;
    p.pitch = 0; p.crouch = 0;
    p.hp = 100; p.armor = 0; p.alive = true;
    p.weapons = createLoadout(p.loadout);
    p.slot = 'primary'; p.equipUntil = 0; p.sprayIndex = 0;
    p.recoil.yaw = p.recoil.pitch = 0;
    p.lastCmd.yaw = p.yaw; p.lastCmd.pitch = 0;
    p.histN = 0;
    this.emit('respawn', { playerId: p.id, x: p.pos.x, z: p.pos.z, yaw: p.yaw });
  }

  emit(type, data) {
    if (this.muted) return;
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

  /**
   * ago 秒前の位置を out に書く (ラグ補償)。撃った人の画面に見えていた位置で判定するため
   */
  rewound(p, ago, out) {
    out.x = p.pos.x; out.y = p.pos.y; out.z = p.pos.z; out.crouch = p.crouch;
    if (ago <= 0 || p.histN < 2) return out;
    const want = this.time - ago, h = p.hist, n = Math.min(p.histN, HIST);
    let newer = -1;
    for (let k = 0; k < n; k++) {
      const i = ((p.histN - 1 - k) % HIST) * HIST_STRIDE;
      if (h[i] <= want) {
        if (newer < 0) return out; // 最新より新しい時刻は現在位置
        const span = h[newer] - h[i], f = span > 0 ? (want - h[i]) / span : 0;
        out.x = h[i + 1] + (h[newer + 1] - h[i + 1]) * f;
        out.y = h[i + 2] + (h[newer + 2] - h[i + 2]) * f;
        out.z = h[i + 3] + (h[newer + 3] - h[i + 3]) * f;
        out.crouch = h[i + 4] + (h[newer + 4] - h[i + 4]) * f;
        return out;
      }
      newer = i;
    }
    if (newer >= 0) { out.x = h[newer + 1]; out.y = h[newer + 2]; out.z = h[newer + 3]; out.crouch = h[newer + 4]; }
    return out;
  }

  /**
   * 1 tick 進める
   * @param cmds {Record<string, object[]>} プレイヤーごとの入力の列 (届いていなければ空でよい)
   *   移動は入力 1 個につき 1 tick ぶん進める。こうするとクライアントの予測と結果が一致する
   */
  step(dt, cmds) {
    this.time += dt;
    this.tick++;
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.respawn && this.time >= p.respawnAt) this.spawn(p);
        continue;
      }
      const list = cmds[p.id];
      const last = p.lastCmd;
      last.reload = false; last.slot = null;
      if (list && list.length) {
        let reload = false, slot = null;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          stepMovement(this, p, c, dt);
          if (c.reload) reload = true;
          if (c.slot) slot = c.slot;
          if (c.seq) p.ack = c.seq;
        }
        Object.assign(last, list[list.length - 1]);
        last.reload = reload; last.slot = slot;
      }
      stepCombat(this, p, last, dt);

      const i = (p.histN++ % HIST) * HIST_STRIDE, h = p.hist;
      h[i] = this.time; h[i + 1] = p.pos.x; h[i + 2] = p.pos.y; h[i + 3] = p.pos.z; h[i + 4] = p.crouch;
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
