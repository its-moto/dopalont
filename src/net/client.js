import { Emitter } from '../core/events.js';
import { World, TICK } from '../sim/world.js';
import { stepMovement } from '../sim/movement.js';
import { createLoadout } from '../sim/combat.js';
import { NET } from './config.js';
import { joinHost } from './peer.js';
import { E, F } from './protocol.js';

const EMPTY = {};
const MAX_PENDING = 128;
const TELEPORT = 3; // これ以上ずれたら、なめらかに直さず一気に合わせる (m)

/** 部屋 (参加側)。ホストとの接続 1 本 */
export class ClientRoom extends Emitter {
  static async join(code, name) {
    const { peer, conn } = await joinHost(code);
    const room = new ClientRoom(peer, conn);
    conn.send({ t: 'hello', name, v: NET.version });
    await room.welcomed;
    return room;
  }

  constructor(peer, conn) {
    super();
    this.isHost = false;
    this.peer = peer;
    this.conn = conn;
    this.myId = null;
    this.lobby = null;
    this.session = null;
    this.dead = false;
    this.welcomed = new Promise((resolve, reject) => {
      this.resolveWelcome = resolve;
      this.rejectWelcome = reject;
      setTimeout(() => reject(new Error('ホストから応答がありません')), NET.connectTimeout);
    });
    conn.on('data', (m) => this.onMessage(m));
    conn.on('close', () => this.closed('ホストとの接続が切れました'));
    conn.on('error', () => this.closed('ホストとの接続でエラーが起きました'));
  }

  onMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 's': this.session?.onSnapshot(m); break;
      case 'ping': this.conn.send({ t: 'pong', ts: m.ts }); break;
      case 'welcome': this.myId = m.id; this.lobby = m.lobby; this.resolveWelcome(); break;
      case 'lobby': this.lobby = m.lobby; this.emit('lobby', m.lobby); break;
      case 'start': this.lobby = m.lobby; this.emit('start', m); break;
      case 'end': this.session = null; this.emit('end'); break;
      case 'bye': this.closed(m.reason); break;
    }
  }

  closed(reason) {
    if (this.dead) return;
    this.dead = true;
    this.rejectWelcome(new Error(reason));
    this.emit('closed', reason);
    this.peer.destroy();
  }

  act(a) { this.conn.send({ t: 'act', a }); }
  sendInput(cmds) { if (this.conn.open) this.conn.send({ t: 'in', c: cmds }); }
  startSession(mapDef, startMsg) { return (this.session = new ClientSession(this, mapDef, startMsg)); }
  close() { this.dead = true; this.peer.destroy(); }
}

const angLerp = (a, b, f) => a + ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI) * f;

/**
 * 試合 (参加側)
 * - 自分: 入力をすぐ手元の sim に反映し (予測)、ホストの結果が届いたら合わせ直す
 * - 他人: 届いたスナップショットを少し遅らせて補間表示する
 */
export class ClientSession {
  constructor(room, mapDef, startMsg) {
    this.mode = 'net';
    this.isHost = false;
    this.room = room;
    this.myId = room.myId;
    this.world = new World(mapDef, { targets: false, infiniteReserve: true });
    this.roster = new Map(startMsg.roster.map((r) => [r.id, r]));
    const mine = this.roster.get(this.myId);
    this.me = null;
    if (mine && mine.team !== 'spec') {
      this.me = this.world.addPlayer(this.myId, { team: mine.team, name: mine.name });
      this.me.alive = false; // 最初のスナップショットが届くまで待つ
    }
    this.clock = () => performance.now() / 1000; // テストでは差し替える
    this.seq = 0;
    this.pending = [];   // ホストがまだ処理していない入力
    this.netQueue = [];  // ホストから届いたイベント
    this.buffers = new Map();
    this.pool = new Map();
    this.remotes = [];
    this.events = [];
    this.acc = 0; this.alpha = 0; this.stepOff = 0;
    this.viewOffset = { x: 0, y: 0, z: 0 };
  }

  update(dt, input) {
    const { world, me } = this;
    this.events = this.netQueue.splice(0);
    this.acc += dt;
    let out = null;
    while (this.acc >= TICK) {
      const cmd = input.sample();
      input.consumeEdges();
      if (me && me.alive) {
        cmd.seq = ++this.seq;
        this.pending.push(cmd);
        if (this.pending.length > MAX_PENDING) this.pending.shift();
        (out ??= []).push(cmd);
        const wasGround = me.onGround, y0 = me.pos.y;
        world.savePrev();
        world.step(TICK, { [this.myId]: [cmd] });
        if (wasGround && me.onGround && Math.abs(me.pos.y - y0) > 0.02) this.stepOff -= me.pos.y - y0;
      } else {
        world.step(TICK, EMPTY);
      }
      this.acc -= TICK;
    }
    if (out) this.room.sendInput(out);
    this.alpha = this.acc / TICK;
    for (const e of world.drainEvents()) this.events.push(e);

    const k = Math.exp(-dt * 12);
    this.viewOffset.x *= k; this.viewOffset.y *= k; this.viewOffset.z *= k;
    this.buildRemotes();
  }

  onSnapshot(m) {
    const now = this.clock();
    for (const e of m.p) {
      if (e[E.ID] === this.myId) { this.reconcile(e); continue; }
      let buf = this.buffers.get(e[E.ID]);
      if (!buf) this.buffers.set(e[E.ID], (buf = []));
      buf.push({ t: now, e });
      if (buf.length > 24) buf.shift();
    }
    if (m.ev) {
      for (const ev of m.ev) {
        if (ev.type === 'shot' && ev.playerId === this.myId) continue; // 自分の射撃は予測で表示済み
        if (ev.type === 'respawn' && ev.playerId === this.myId) continue; // 自分の復活は reconcile が知らせる
        if (ev.type === 'kill') {
          const k = this.roster.get(ev.playerId), v = this.roster.get(ev.victimId);
          if (k) k.kills++;
          if (v) v.deaths++;
        } else if (ev.type === 'join') {
          this.roster.set(ev.player.id, ev.player);
        } else if (ev.type === 'left') {
          this.roster.delete(ev.playerId); this.buffers.delete(ev.playerId); this.pool.delete(ev.playerId);
        }
        this.netQueue.push(ev);
      }
    }
  }

  /** ホストの結果に自分の状態を合わせ、まだ処理されていない入力をやり直す */
  reconcile(e) {
    const me = this.me, world = this.world;
    if (!me) return;
    const alive = (e[E.FLAGS] & F.ALIVE) !== 0;
    me.hp = e[E.HP]; me.armor = e[E.ARMOR];
    if (!alive) { me.alive = false; this.pending.length = 0; return; }

    const ox = me.pos.x, oy = me.pos.y, oz = me.pos.z;
    if (!me.alive) { // 復活した
      me.alive = true;
      me.weapons = createLoadout(me.loadout);
      me.slot = 'primary'; me.equipUntil = 0; me.sprayIndex = 0;
      me.recoil.yaw = me.recoil.pitch = 0;
      this.pending.length = 0;
      // 向きをスポーンの向きに合わせてもらう (イベントを取りこぼしても復活できるよう、ここで作る)
      this.netQueue.push({ type: 'respawn', playerId: this.myId, x: e[E.X], z: e[E.Z], yaw: e[E.YAW] });
    }
    const ack = e[E.ACK];
    let n = 0;
    while (n < this.pending.length && this.pending[n].seq <= ack) n++;
    if (n) this.pending.splice(0, n);

    me.pos.x = e[E.X]; me.pos.y = e[E.Y]; me.pos.z = e[E.Z];
    me.vel.x = e[E.VX]; me.vel.y = e[E.VY]; me.vel.z = e[E.VZ];
    me.crouch = e[E.CROUCH];
    me.onGround = (e[E.FLAGS] & F.GROUND) !== 0;
    const stepDist = me.stepDist;
    world.muted = true; // やり直しでは足音などを鳴らさない
    for (const c of this.pending) stepMovement(world, me, c, TICK);
    world.muted = false;
    me.stepDist = stepDist;

    // 見た目が飛ばないよう、ずれは viewOffset に逃がして少しずつ消す
    const dx = me.pos.x - ox, dy = me.pos.y - oy, dz = me.pos.z - oz;
    me.prev.x += dx; me.prev.y += dy; me.prev.z += dz;
    const v = this.viewOffset;
    if (Math.hypot(dx, dy, dz) > TELEPORT) { v.x = v.y = v.z = 0; me.prev.x = me.pos.x; me.prev.y = me.pos.y; me.prev.z = me.pos.z; }
    else { v.x -= dx; v.y -= dy; v.z -= dz; }
  }

  buildRemotes() {
    const t = this.clock() - NET.interpDelay, out = this.remotes;
    out.length = 0;
    for (const [id, buf] of this.buffers) {
      const info = this.roster.get(id);
      if (!info || !buf.length) continue;
      let r = this.pool.get(id);
      if (!r) this.pool.set(id, (r = { id, name: info.name, team: info.team }));
      // t を挟む 2 つのスナップショットを探す
      let i = buf.length - 1;
      while (i > 0 && buf[i].t > t) i--;
      const a = buf[i], b = buf[Math.min(i + 1, buf.length - 1)];
      const ea = a.e, eb = b.e;
      const aliveA = (ea[E.FLAGS] & F.ALIVE) !== 0, aliveB = (eb[E.FLAGS] & F.ALIVE) !== 0;
      // 復活や死亡をまたぐ時は補間しない (スポーンまで滑って見えるのを防ぐ)
      const f = aliveA !== aliveB ? 1 : b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      r.x = ea[E.X] + (eb[E.X] - ea[E.X]) * f;
      r.y = ea[E.Y] + (eb[E.Y] - ea[E.Y]) * f;
      r.z = ea[E.Z] + (eb[E.Z] - ea[E.Z]) * f;
      r.yaw = angLerp(ea[E.YAW], eb[E.YAW], f);
      r.pitch = ea[E.PITCH] + (eb[E.PITCH] - ea[E.PITCH]) * f;
      r.crouch = ea[E.CROUCH] + (eb[E.CROUCH] - ea[E.CROUCH]) * f;
      r.alive = f >= 1 ? aliveB : aliveA;
      r.onGround = (eb[E.FLAGS] & F.GROUND) !== 0;
      out.push(r);
    }
  }
}
