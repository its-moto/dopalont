import { Emitter } from '../core/events.js';
import { clamp, lerp } from '../core/math.js';
import { World, TICK } from '../sim/world.js';
import { NET } from './config.js';
import * as L from './lobby.js';
import { openHost } from './peer.js';
import { packPlayer, NET_EVENTS } from './protocol.js';

const MAX_PLAYERS = 12; // 5v5 + 観戦 2
const PITCH_LIMIT = 1.56;
const num = (v) => (Number.isFinite(v) ? v : 0);

/** クライアントから来た入力を信用せず、形と範囲を整える */
function cleanCmd(c) {
  return {
    seq: num(c.seq) | 0,
    mx: clamp(num(c.mx), -1, 1), mz: clamp(num(c.mz), -1, 1),
    jump: !!c.jump, crouch: !!c.crouch, walk: !!c.walk, fire: !!c.fire, alt: !!c.alt, reload: !!c.reload,
    slot: c.slot === 'primary' || c.slot === 'sidearm' ? c.slot : null,
    yaw: num(c.yaw), pitch: clamp(num(c.pitch), -PITCH_LIMIT, PITCH_LIMIT),
  };
}

/** 部屋 (ホスト側)。接続の管理とロビー。試合中は HostSession を持つ */
export class HostRoom extends Emitter {
  static async create(name) {
    const { peer, code } = await openHost();
    return new HostRoom(peer, code, name);
  }

  constructor(peer, code, name) {
    super();
    this.isHost = true;
    this.peer = peer;
    this.myId = 'h';
    this.lobby = L.createLobby(code);
    L.addPlayer(this.lobby, { id: this.myId, name, host: true });
    this.conns = new Map(); // id → { conn, queue, rtt }
    this.nextId = 1;
    this.session = null;
    peer.on('connection', (conn) => this.onConn(conn));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); }); // 仲介サーバーとの接続だけ切れた場合
    this.pingTimer = setInterval(() => this.broadcast({ t: 'ping', ts: performance.now() }), 1000);
  }

  onConn(conn) {
    let id = null;
    const bye = (reason) => { try { conn.send({ t: 'bye', reason }); } catch { /* 既に切れている */ } setTimeout(() => conn.close(), 300); };
    conn.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        if (id) return;
        if (m.v !== NET.version) { bye('ゲームの版が違います。ページを再読み込みしてください'); return; }
        if (this.lobby.players.length >= MAX_PLAYERS) { bye('部屋が満員です'); return; }
        id = 'c' + this.nextId++;
        this.conns.set(id, { conn, queue: [], rtt: 0.06 });
        const pl = L.addPlayer(this.lobby, { id, name: String(m.name || '') });
        conn.send({ t: 'welcome', id, lobby: this.lobby });
        if (this.session) { // 試合の途中から参加
          this.session.addPlayer(pl);
          conn.send({ t: 'start', lobby: this.lobby, roster: this.session.rosterList() });
        }
        this.lobbyChanged();
        return;
      }
      if (id) this.onMessage(id, m);
    });
    conn.on('close', () => { if (id) this.drop(id); });
    conn.on('error', () => { if (id) this.drop(id); });
  }

  onMessage(id, m) {
    const c = this.conns.get(id);
    if (!c) return;
    if (m.t === 'in') this.session?.onInput(c, m.c);
    else if (m.t === 'act') this.apply(id, m.a);
    else if (m.t === 'pong') c.rtt = lerp(c.rtt, (performance.now() - num(m.ts)) / 1000, 0.3);
  }

  /** ロビー操作 (自分のぶん) */
  act(a) { this.apply(this.myId, a); }

  apply(id, a) {
    if (!a || this.lobby.inGame) return;
    if (a.type === 'team') L.setTeam(this.lobby, id, a.team);
    else if (a.type === 'ready') L.setReady(this.lobby, id, a.ready);
    else return;
    this.lobbyChanged();
  }

  /** ホストだけができる操作 */
  hostAct(a) {
    if (a.type === 'kick') { this.kick(a.id); return; }
    if (this.lobby.inGame) return;
    if (a.type === 'move') L.setTeam(this.lobby, a.id, a.team);
    else if (a.type === 'balance') L.autoBalance(this.lobby);
    else if (a.type === 'shuffle') L.shuffle(this.lobby);
    this.lobbyChanged();
  }

  kick(id) {
    const c = this.conns.get(id);
    if (!c) return;
    try { c.conn.send({ t: 'bye', reason: 'ホストに退出させられました' }); } catch { /* 既に切れている */ }
    setTimeout(() => c.conn.close(), 300);
    this.drop(id);
  }

  drop(id) {
    if (!this.conns.delete(id)) return;
    L.removePlayer(this.lobby, id);
    this.session?.removePlayer(id);
    this.lobbyChanged();
  }

  lobbyChanged() {
    this.broadcast({ t: 'lobby', lobby: this.lobby });
    this.emit('lobby', this.lobby);
  }

  broadcast(msg) {
    for (const c of this.conns.values()) if (c.conn.open) c.conn.send(msg);
  }

  startGame(mapDef) {
    this.lobby.inGame = true;
    this.session = new HostSession(this, mapDef);
    this.broadcast({ t: 'start', lobby: this.lobby, roster: this.session.rosterList() });
    this.lobbyChanged();
    return this.session;
  }

  endGame() {
    this.session = null;
    this.lobby.inGame = false;
    for (const p of this.lobby.players) p.ready = p.host;
    this.broadcast({ t: 'end' });
    this.lobbyChanged();
  }

  close() {
    clearInterval(this.pingTimer);
    this.peer.destroy();
  }
}

/** 試合 (ホスト側)。本物の sim を動かし、結果を全員に配る */
export class HostSession {
  constructor(room, mapDef) {
    this.mode = 'net';
    this.isHost = true;
    this.room = room;
    this.myId = room.myId;
    this.world = new World(mapDef, { seed: (Math.random() * 1e9) | 0, targets: false, respawn: true, infiniteReserve: true });
    this.roster = new Map();
    this.events = [];
    this.async = [];  // 更新の合間 (通信の受信時) に起きたイベント
    this.netEv = [];  // 次のスナップショットに載せるイベント
    for (const pl of room.lobby.players) this.addPlayer(pl, true);
    this.me = this.world.players.get(this.myId) || null;
    this.remotes = [];
    this.pool = new Map();
    this.acc = 0; this.alpha = 0; this.stepOff = 0;
    this.viewOffset = { x: 0, y: 0, z: 0 };
  }

  rosterList() { return [...this.roster.values()]; }

  addPlayer(pl, initial = false) {
    const entry = { id: pl.id, name: pl.name, team: pl.team, kills: 0, deaths: 0 };
    this.roster.set(pl.id, entry);
    if (pl.team !== 'spec') this.world.spawn(this.world.addPlayer(pl.id, { team: pl.team, name: pl.name }));
    if (!initial) this.note({ type: 'join', player: entry });
  }

  removePlayer(id) {
    if (!this.roster.delete(id)) return;
    this.world.removePlayer(id);
    this.pool.delete(id);
    this.note({ type: 'left', playerId: id });
  }

  note(e) { this.async.push(e); this.netEv.push(e); }

  onInput(c, cmds) {
    if (!Array.isArray(cmds)) return;
    for (const cmd of cmds) if (cmd && typeof cmd === 'object') c.queue.push(cleanCmd(cmd));
    if (c.queue.length > NET.maxQueue) c.queue.splice(0, c.queue.length - NET.maxQueue / 2); // 溜まりすぎたら古いものを捨てる
  }

  update(dt, input) {
    const { world, me, room } = this;
    this.events = this.async.splice(0);
    this.acc += dt;
    while (this.acc >= TICK) {
      const cmds = {};
      if (me) cmds[this.myId] = [input.sample()];
      input.consumeEdges();
      for (const [id, c] of room.conns) {
        const p = world.players.get(id);
        if (!p) continue;
        if (!p.alive) { c.queue.length = 0; continue; }
        if (c.queue.length) cmds[id] = c.queue.splice(0, NET.maxCmdsPerTick);
        // その人の画面は「往復の遅延 + 補間の遅れ」だけ過去を映している
        p.lagComp = Math.min(NET.maxLagComp, c.rtt + NET.interpDelay);
      }

      const wasGround = me?.onGround, y0 = me?.pos.y;
      world.savePrev();
      world.step(TICK, cmds);
      if (me && wasGround && me.onGround && Math.abs(me.pos.y - y0) > 0.02) this.stepOff -= me.pos.y - y0;

      for (const e of world.drainEvents()) {
        if (e.type === 'kill') {
          const k = this.roster.get(e.playerId), v = this.roster.get(e.victimId);
          if (k) k.kills++;
          if (v) v.deaths++;
        }
        this.events.push(e);
        if (NET_EVENTS.has(e.type)) this.netEv.push(e);
      }
      if (world.tick % NET.snapshotEvery === 0) this.sendSnapshot();
      this.acc -= TICK;
    }
    this.alpha = this.acc / TICK;
    this.buildRemotes();
  }

  sendSnapshot() {
    const p = [];
    for (const pl of this.world.players.values()) p.push(packPlayer(pl));
    const msg = { t: 's', k: this.world.tick, p };
    if (this.netEv.length) { msg.ev = this.netEv; this.netEv = []; }
    this.room.broadcast(msg);
  }

  buildRemotes() {
    const a = this.alpha, out = this.remotes;
    out.length = 0;
    for (const p of this.world.players.values()) {
      if (p.id === this.myId) continue;
      let r = this.pool.get(p.id);
      if (!r) this.pool.set(p.id, (r = { id: p.id, name: p.name, team: p.team }));
      r.x = lerp(p.prev.x, p.pos.x, a); r.y = lerp(p.prev.y, p.pos.y, a); r.z = lerp(p.prev.z, p.pos.z, a);
      r.yaw = p.yaw; r.pitch = p.pitch; r.crouch = p.crouch; r.alive = p.alive; r.onGround = p.onGround;
      out.push(r);
    }
  }
}
