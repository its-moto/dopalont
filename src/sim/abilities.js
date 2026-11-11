import { AGENTS } from '../data/agents.js';
import { eyeHeight } from './movement.js';
import { rayWalls, blocked, damageEntity, createLoadout } from './combat.js';
import { setSlot, emitInv } from './round.js';
import { floorAt } from './map.js';

// アビリティの仕組み (DESIGN.md §6)。ホストの sim だけが動かす
//
// world.ents: 場に出ている物の一覧。{ id, kind, x, y, z, r, x2, z2, team, owner, ttl, ... }
//   kind: proj (飛んでいる投げ物) / smoke / fire / slow / stim / strike (エリア効果) / warn (落下予告)
//         firewall (x,z → x2,z2 の線) / ice (氷の壁 1 枚。x2,z2 は半幅、r は高さ) / recon / drone / marker / orb
// world.marks: 索敵で見えている敵の印 (毎 tick 作り直す。team = 見える側のチーム)

const ZONE_TICK = 0.25;   // エリアのダメージと回復を与える間隔
const GRAVITY_Y = 2.5;    // エリア効果が届く上下の幅

export function initAbilities(p, agentId) {
  p.agent = AGENTS[agentId] ? agentId : 'gale';
  p.abil = { c: 0, q: 0, e: 0 };
  p.abilCd = 0; p.ult = 0; p.killsSince = 0; p.ultEnd = 0; p.deathPos = null;
  resetStatus(p);
}

function resetStatus(p) {
  p.dashT = 0; p.dashX = 0; p.dashZ = 0;
  p.slowMul = 1; p.noJump = false; p.rateMul = 1;
  p.hot = 0; p.hotRate = 0;
  p.recall = null; p.revealUntil = 0; p.revealTeam = null;
  p.armed = null; // 構えているアビリティのキー
}

const defsOf = (p) => AGENTS[p.agent].abilities;

export function emitAbil(world, p) {
  world.emit('abil', { playerId: p.id, c: p.abil.c, q: p.abil.q, e: p.abil.e, cd: Math.max(0, Math.round(p.abilCd * 10) / 10), ult: p.ult, armed: p.armed });
}

export function addUlt(world, p, n = 1) {
  const cost = defsOf(p).x.ult;
  if (p.ult >= cost) return;
  p.ult = Math.min(cost, p.ult + n);
  emitAbil(world, p);
  if (p.ult >= cost) world.emit('ultReady', { playerId: p.id });
}

export function addEnt(world, o) {
  const e = { id: 'e' + ++world.entSeq, r: 0, x2: 0, z2: 0, team: null, owner: null, ttl: 1, ...o };
  world.ents.push(e);
  return e;
}

function removeEnt(world, i) {
  const e = world.ents[i];
  if (e.kind === 'ice') {
    const k = world.boxes.findIndex((b) => b.entId === e.id);
    if (k >= 0) world.boxes.splice(k, 1);
  }
  world.ents.splice(i, 1);
}

export function clearEnts(world) {
  world.boxes.length = world.staticBoxes;
  world.ents.length = 0;
  world.marks.length = 0;
}

/** ラウンド開始時: 場の物を片付け、シグネチャーを補充し、オーブを置く */
export function roundAbilities(world) {
  clearEnts(world);
  for (const p of world.players.values()) {
    resetStatus(p);
    if (p.loadout.ult) { delete p.loadout.ult; delete p.weapons.ult; }
    const e = defsOf(p).e;
    if (!e.cooldown) p.abil.e = Math.max(p.abil.e, e.free || 0);
    p.abilCd = 0; p.killsSince = 0;
    emitAbil(world, p);
  }
  for (const o of world.map.def.orbs || []) {
    addEnt(world, { kind: 'orb', x: o.x, y: Math.max(0, floorAt(world.map, o.x, o.z)) + 1, z: o.z, r: 0.35, ttl: Infinity });
  }
}

/** キルが起きた時: アルティメットポイントと、キルで回復するスキル */
export function abilityKill(world, killer, victim) {
  if (victim.agent) { addUlt(world, victim); victim.dashT = 0; victim.hot = 0; }
  if (!killer || killer === victim || !killer.agent || killer.team === victim.team) return;
  addUlt(world, killer);
  const e = defsOf(killer).e;
  if (e.killsRecharge && killer.abil.e < (e.free || 1) && ++killer.killsSince >= e.killsRecharge) {
    killer.killsSince = 0;
    killer.abil.e++;
    emitAbil(world, killer);
  }
}

/** リワインド: 使った場所に全快で戻る */
export function recallBack(world, p) {
  const r = p.recall;
  p.recall = null;
  p.pos.x = r.x; p.pos.y = r.y; p.pos.z = r.z;
  p.prev.x = r.x; p.prev.y = r.y; p.prev.z = r.z;
  p.vel.x = p.vel.y = p.vel.z = 0;
  p.hp = 100; p.histN = 0;
  const i = world.ents.findIndex((e) => e.kind === 'marker' && e.owner === p.id);
  if (i >= 0) removeEnt(world, i);
  world.emit('effect', { kind: 'recall', x: r.x, y: r.y, z: r.z });
}

export function buyAbility(world, p, key) {
  const def = defsOf(p)[key];
  if (!def || !def.price || p.abil[key] >= def.max || p.credits < def.price) return false;
  p.credits -= def.price;
  p.abil[key]++;
  p.bought['ab:' + key] = (p.bought['ab:' + key] || 0) + 1; // このラウンドに買った数。売却で全額戻る
  emitAbil(world, p);
  emitInv(world, p);
  return true;
}

/** このラウンドに買ったアビリティを 1 回ぶん売る */
export function sellAbility(world, p, key) {
  const def = defsOf(p)[key], n = p.bought['ab:' + key] || 0;
  if (!def || n <= 0 || p.abil[key] <= 0) return false;
  p.bought['ab:' + key] = n - 1;
  p.abil[key]--;
  p.credits += def.price;
  emitAbil(world, p);
  emitInv(world, p);
  return true;
}

// ---- 向きと狙い ----
const fwd3 = (p) => { const cp = Math.cos(p.pitch); return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp]; };
const eyeOf = (p) => [p.pos.x, p.pos.y + eyeHeight(p), p.pos.z];
const inZone = (e, p) => Math.hypot(p.pos.x - e.x, p.pos.z - e.z) <= e.r && Math.abs(p.pos.y - e.y) < GRAVITY_Y;

/** 視線の先の床の位置。壁に当たったら、その手前の床 */
function aimPoint(world, p, range) {
  const o = eyeOf(p), d = fwd3(p);
  const hit = rayWalls(world, o, d, range);
  const t = Math.max(0, (hit ? hit.t : range) - 0.4);
  const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
  const floor = floorAt(world.map, x, z);
  if (floor < 0) return null;
  return { x, y: hit && hit.normal[1] > 0 ? o[1] + d[1] * hit.t : floor, z };
}

/** 視線に一番近い相手を探す。pick(q) が位置 {x,y,z} を返した相手だけが候補 */
function aimTarget(world, p, pick, range, maxDeg) {
  const o = eyeOf(p), d = fwd3(p);
  let best = null, bestCos = Math.cos((maxDeg * Math.PI) / 180);
  for (const q of world.players.values()) {
    if (q === p || q.team !== p.team) continue;
    const at = pick(q);
    if (!at) continue;
    const v = [at.x - o[0], at.y + 1 - o[1], at.z - o[2]], len = Math.hypot(v[0], v[1], v[2]);
    if (len > range) continue;
    const c = len < 0.01 ? 1 : (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / len;
    if (c > bestCos && !blocked(world.boxes, o, [at.x, at.y + 1, at.z])) { bestCos = c; best = q; }
  }
  return best;
}

// ---- 効果の発生 ----
function spawnEffect(world, eff, x, y, z, owner, team) {
  if (eff.zone) {
    addEnt(world, { kind: eff.zone, x, y, z, r: eff.r, ttl: eff.dur, tick: 0, eff, owner, team });
    world.emit('effect', { kind: eff.zone, x, y, z });
  }
  if (eff.flash) { // 見通せて、そちらを向いている全員の目がくらむ (味方も自分も)
    world.emit('effect', { kind: 'flash', x, y, z });
    for (const q of world.players.values()) {
      if (!q.alive) continue;
      const o = eyeOf(q), v = [x - o[0], y - o[1], z - o[2]], len = Math.hypot(v[0], v[1], v[2]);
      if (len > eff.flash.range || blocked(world.boxes, o, [x, y, z])) continue;
      const d = fwd3(q), facing = len < 0.01 ? 1 : (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / len;
      if (facing < 0.15) continue; // 背を向けていれば平気
      world.emit('flashed', { victimId: q.id, dur: eff.flash.dur * (facing > 0.6 ? 1 : 0.6) });
    }
  }
  if (eff.blast) {
    world.emit('effect', { kind: 'blast', x, y, z });
    const attacker = world.players.get(owner) || null;
    for (const q of [...world.players.values()]) {
      if (!q.alive || q.team === team) continue;
      const dist = Math.hypot(q.pos.x - x, q.pos.y + 1 - y, q.pos.z - z);
      if (dist > eff.blast.r || blocked(world.boxes, [x, y, z], [q.pos.x, q.pos.y + 1, q.pos.z])) continue;
      damageEntity(world, attacker, q, Math.round(eff.blast.dmg * (1 - (dist / eff.blast.r) * 0.6)), 'body', [q.pos.x, q.pos.y + 1, q.pos.z], 'ability');
    }
  }
  if (eff.recon) {
    addEnt(world, { kind: 'recon', x, y, z, r: eff.recon.r, ttl: 8, next: 0.6, pulses: eff.recon.pulses, eff, owner, team });
  }
}

/** その場所から見通せる敵を、team の全員に見せる */
function reveal(world, e, r, secs) {
  let found = false;
  for (const q of world.players.values()) {
    if (!q.alive || q.team === e.team) continue;
    if (Math.hypot(q.pos.x - e.x, q.pos.z - e.z) > r) continue;
    if (blocked(world.boxes, [e.x, e.y + 0.2, e.z], [q.pos.x, q.pos.y + 1.2, q.pos.z])) continue;
    q.revealUntil = world.time + secs; q.revealTeam = e.team;
    found = true;
  }
  world.emit('effect', { kind: 'ping', x: e.x, y: e.y, z: e.z, found });
}

// ---- 発動 ----
function cast(world, p, key, def, variant) {
  const o = eyeOf(p), d = fwd3(p), base = { owner: p.id, team: p.team };
  switch (def.kind) {
    case 'throw': {
      const s = def.proj.speed;
      addEnt(world, { ...base, kind: 'proj', x: o[0] + d[0] * 0.5, y: o[1] + d[1] * 0.5 - 0.1, z: o[2] + d[2] * 0.5,
        vx: d[0] * s, vy: d[1] * s + (def.proj.gravity > 10 ? 2.5 : 0), vz: d[2] * s,
        r: 0.12, ttl: def.proj.fuse, bounces: def.proj.bounces ?? 3, def,
        turn: def.curve ? (variant === 'R' ? -def.curve : def.curve) : 0 }); // 左クリックなら左へ、右クリックなら右へ曲がる
      return true;
    }
    case 'updraft': p.vel.y = def.v; p.onGround = false; return true;
    case 'dash': {
      // 押している方向へ。何も押していなければ前へ
      const c = p.lastCmd, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      let dx = -sy * c.mz + cy * c.mx, dz = -cy * c.mz - sy * c.mx;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) { dx = -sy; dz = -cy; } else { dx /= len; dz /= len; }
      p.dashT = def.dur; p.dashX = dx * def.speed; p.dashZ = dz * def.speed;
      return true;
    }
    case 'weapon':
      p.loadout.ult = def.weapon;
      setSlot(p, 'ult', def.weapon);
      p.ultEnd = world.time + (def.dur || 1e9);
      p.lastShotTime = world.time;
      if (world.round) emitInv(world, p);
      return true;
    case 'firewall': {
      const h = Math.hypot(d[0], d[2]) || 1, fx = d[0] / h, fz = d[2] / h;
      const start = [p.pos.x + fx * 1.5, p.pos.y + 1, p.pos.z + fz * 1.5];
      const hit = rayWalls(world, start, [fx, 0, fz], def.length);
      const len = hit ? hit.t : def.length;
      if (len < 2) return false;
      addEnt(world, { ...base, kind: 'firewall', x: start[0], y: p.pos.y, z: start[2], x2: start[0] + fx * len, z2: start[2] + fz * len,
        r: 1, ttl: def.dur, tick: 0, def });
      world.emit('effect', { kind: 'fire', x: start[0], y: p.pos.y, z: start[2] });
      return true;
    }
    case 'recall':
      p.recall = { x: p.pos.x, y: p.pos.y, z: p.pos.z, until: world.time + def.dur };
      addEnt(world, { ...base, kind: 'marker', x: p.pos.x, y: p.pos.y, z: p.pos.z, r: 0.8, ttl: def.dur });
      return true;
    case 'place': spawnEffect(world, def.effect, p.pos.x, p.pos.y, p.pos.z, p.id, p.team); return true;
    case 'aim': {
      const pt = aimPoint(world, p, def.range);
      if (!pt) return false;
      addEnt(world, { ...base, kind: 'warn', x: pt.x, y: pt.y, z: pt.z, r: def.effect.r, ttl: def.delay, then: def.effect });
      return true;
    }
    case 'drone': {
      const h = Math.hypot(d[0], d[2]) || 1;
      addEnt(world, { ...base, kind: 'drone', x: o[0], y: o[1], z: o[2], vx: (d[0] / h) * def.speed, vz: (d[2] / h) * def.speed, r: def.r, ttl: def.dur, tick: 0 });
      return true;
    }
    case 'icewall': {
      const h = Math.hypot(d[0], d[2]) || 1, cx = p.pos.x + (d[0] / h) * def.dist, cz = p.pos.z + (d[2] / h) * def.dist;
      const alongX = Math.abs(d[2]) >= Math.abs(d[0]); // 向いている方向に対して横に伸ばす (箱は斜めに置けない)
      let made = 0;
      for (let i = 0; i < def.segs; i++) {
        const off = (i - (def.segs - 1) / 2) * def.segW;
        const x = cx + (alongX ? off : 0), z = cz + (alongX ? 0 : off);
        const floor = floorAt(world.map, x, z);
        if (floor < 0) continue;
        const hw = (alongX ? def.segW : def.thick) / 2, hd = (alongX ? def.thick : def.segW) / 2;
        let clash = false; // 人が立っている所には生やさない
        for (const q of world.players.values()) {
          if (q.alive && Math.abs(q.pos.x - x) < hw + 0.4 && Math.abs(q.pos.z - z) < hd + 0.4 && q.pos.y < floor + def.height && q.pos.y + 1.8 > floor) clash = true;
        }
        if (clash) continue;
        const e = addEnt(world, { ...base, kind: 'ice', x, y: floor, z, x2: hw, z2: hd, r: def.height, ttl: def.dur });
        world.boxes.push({ min: [x - hw, floor, z - hd], max: [x + hw, floor + def.height, z + hd], mat: 'ice', kind: 'dyn', hp: def.hp, entId: e.id });
        made++;
      }
      if (made) world.emit('effect', { kind: 'ice', x: cx, y: p.pos.y, z: cz });
      return made > 0;
    }
    case 'heal': {
      const ally = aimTarget(world, p, (q) => (q.alive && q.hp < 100 ? q.pos : null), def.range, 12);
      const target = ally || p, amount = ally ? def.amount : def.self;
      if (target.hp >= 100) return false;
      target.hot = amount; target.hotRate = amount / def.over;
      world.emit('effect', { kind: 'heal', x: target.pos.x, y: target.pos.y, z: target.pos.z });
      return true;
    }
    case 'revive': {
      const ally = aimTarget(world, p, (q) => (!q.alive && q.deathPos ? q.deathPos : null), def.range, 30);
      if (!ally) return false;
      const dp = ally.deathPos;
      world.spawn(ally, { x: dp.x, z: dp.z });
      ally.pos.y = ally.prev.y = dp.y;
      world.emit('effect', { kind: 'revive', x: dp.x, y: dp.y, z: dp.z });
      return true;
    }
  }
  return false;
}

// 狙いをつけるアビリティは二段階: キーで構える → 左クリックで発動。もう一度キーを押すか右クリックで取り消し
// (curve つきは右クリックも発動で、曲がる向きが変わる。取り消しはキーか武器の持ち替え)
const ARM_KINDS = new Set(['throw', 'aim', 'firewall', 'icewall', 'drone']);

function canUse(world, p, key, def) {
  if (!def || !p.alive || p.acting) return false;
  if (world.round && world.round.phase === 'buy') return false;
  const free = world.freeAbilities; // 射撃場: 回数もポイントも減らない
  if ((def.cooldown || free) && p.abilCd > 0 && key === 'e') return false;
  if (free) return true;
  if (key === 'x') return p.ult >= def.ult;
  return !!def.cooldown || p.abil[key] > 0;
}

/**
 * アビリティのキーが押された。すぐ発動するものは発動し、狙いをつけるものは構える (もう一度押すと取り消し)
 * variant を渡すと構えを飛ばして発動する ('L' / 'R' = 左右のクリック)
 */
export function useAbility(world, p, key, variant = null) {
  const def = defsOf(p)[key];
  if (!variant && p.armed === key) { p.armed = null; emitAbil(world, p); return false; }
  if (!canUse(world, p, key, def)) return false;
  if (!variant && ARM_KINDS.has(def.kind)) {
    p.armed = key;
    emitAbil(world, p);
    world.emit('armed', { playerId: p.id, key });
    return false;
  }
  p.armed = null;
  const free = world.freeAbilities;
  if (!cast(world, p, key, def, variant)) { emitAbil(world, p); return false; }
  if (key === 'x') { if (!free) p.ult = 0; }
  else if (def.cooldown) p.abilCd = free ? 3 : def.cooldown;
  else if (!free) p.abil[key]--;
  emitAbil(world, p);
  world.emit('ability', { playerId: p.id, key, kind: def.kind, x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z });
  return true;
}

/** 構えている間の入力: 左クリックで発動、右クリックで取り消し (curve つきは右へ曲げて発動)、武器の持ち替えで取り消し */
export function armedInput(world, p, inp) {
  const def = defsOf(p)[p.armed];
  if (inp.slot) { p.armed = null; emitAbil(world, p); return; }
  if (inp.fire || inp.alt) p.holdFire = true; // このクリックで武器まで撃ってしまわないように (combat が見る)
  if (inp.fire && !p.prevFire) useAbility(world, p, p.armed, 'L');
  else if (inp.alt && !p.prevAlt) {
    if (def.curve) useAbility(world, p, p.armed, 'R');
    else { p.armed = null; emitAbil(world, p); }
  }
}

// ---- 毎 tick ----
function stepZone(world, e, dt) {
  const eff = e.eff, owner = world.players.get(e.owner) || null;
  let tick = false;
  e.tick -= dt;
  if (e.tick <= 0) { e.tick += ZONE_TICK; tick = true; }
  for (const q of [...world.players.values()]) {
    if (!q.alive || !inZone(e, q)) continue;
    const enemy = q.team !== e.team;
    if (e.kind === 'slow') { q.slowMul = Math.min(q.slowMul, eff.mul); q.noJump = true; }
    else if (e.kind === 'stim') { if (!enemy) { q.rateMul = 1.1; q.slowMul *= 1.1; } }
    else if (tick && (e.kind === 'fire' || e.kind === 'strike')) {
      if (enemy) damageEntity(world, owner, q, Math.round(eff.dps * ZONE_TICK), 'body', [q.pos.x, q.pos.y + 1, q.pos.z], 'ability');
      else if (q.id === e.owner && eff.healOwner) q.hp = Math.min(100, q.hp + eff.healOwner * ZONE_TICK);
    }
  }
}

function stepFirewall(world, e, dt) {
  e.tick -= dt;
  if (e.tick > 0) return;
  e.tick += ZONE_TICK;
  const owner = world.players.get(e.owner) || null;
  const dx = e.x2 - e.x, dz = e.z2 - e.z, len2 = dx * dx + dz * dz;
  for (const q of [...world.players.values()]) {
    if (!q.alive || Math.abs(q.pos.y - e.y) > GRAVITY_Y) continue;
    const t = Math.max(0, Math.min(1, ((q.pos.x - e.x) * dx + (q.pos.z - e.z) * dz) / len2));
    if (Math.hypot(q.pos.x - (e.x + dx * t), q.pos.z - (e.z + dz * t)) > e.r) continue;
    if (q.team !== e.team) damageEntity(world, owner, q, Math.round(e.def.dps * ZONE_TICK), 'body', [q.pos.x, q.pos.y + 1, q.pos.z], 'ability');
    else if (q.id === e.owner) q.hp = Math.min(100, q.hp + e.def.heal * ZONE_TICK);
  }
}

/** 投げ物を進める。発動したら true (呼び出し側が取り除く) */
function stepProj(world, e, dt) {
  const pr = e.def.proj;
  e.vy -= pr.gravity * dt;
  if (e.turn) { // 飛びながら横に曲がる
    const a = e.turn * dt, c = Math.cos(a), sn = Math.sin(a), vx = e.vx;
    e.vx = vx * c + e.vz * sn; e.vz = e.vz * c - vx * sn;
  }
  const len = Math.hypot(e.vx, e.vy, e.vz) * dt;
  if (len > 1e-6) {
    const d = [e.vx * dt / len, e.vy * dt / len, e.vz * dt / len];
    const hit = rayWalls(world, [e.x, e.y, e.z], d, len + 0.06);
    if (hit) {
      const t = Math.max(0, hit.t - 0.06);
      e.x += d[0] * t; e.y += d[1] * t; e.z += d[2] * t;
      if (pr.stick) return true;
      const n = hit.normal, floor = n[1] > 0;
      // 跳ね返る。床で勢いがなくなったら止まる
      if (n[0]) e.vx = -e.vx * 0.45; if (n[1]) e.vy = -e.vy * 0.35; if (n[2]) e.vz = -e.vz * 0.45;
      if (!n[0]) e.vx *= 0.7; if (!n[2]) e.vz *= 0.7;
      if (--e.bounces < 0) return true;
      if (floor && pr.onStop && Math.abs(e.vy) < 3) return true;
    } else {
      e.x += d[0] * len; e.y += d[1] * len; e.z += d[2] * len;
    }
  }
  return e.ttl <= 0;
}

export function stepAbilities(world, dt) {
  const t = world.time;
  for (const p of world.players.values()) {
    p.slowMul = 1; p.noJump = false; p.rateMul = 1;
    if (p.abilCd > 0) { p.abilCd -= dt; if (p.abilCd <= 0) emitAbil(world, p); }
    if (!p.alive) continue;
    if (p.hot > 0) { const h = Math.min(p.hot, p.hotRate * dt); p.hot -= h; p.hp = Math.min(100, p.hp + h); }
    if (p.recall && t >= p.recall.until) recallBack(world, p);
    const u = p.weapons.ult; // アルティメットの武器は、弾切れか時間切れで消える
    if (u && ((u.ammo <= 0 && t - p.lastShotTime > 0.35) || t > p.ultEnd)) {
      delete p.loadout.ult;
      setSlot(p, 'ult', null);
      if (world.round) emitInv(world, p);
      world.emit('equip', { playerId: p.id, weapon: p.weapons[p.slot].def.id, dur: 0.3 });
    }
  }

  for (let i = world.ents.length - 1; i >= 0; i--) {
    const e = world.ents[i];
    e.ttl -= dt;
    let done = e.ttl <= 0;
    switch (e.kind) {
      case 'proj':
        if (stepProj(world, e, dt)) { spawnEffect(world, e.def.effect, e.x, e.y, e.z, e.owner, e.team); done = true; }
        break;
      case 'fire': case 'slow': case 'stim': case 'strike': stepZone(world, e, dt); break;
      case 'firewall': stepFirewall(world, e, dt); break;
      case 'warn':
        if (done) spawnEffect(world, e.then, e.x, e.y, e.z, e.owner, e.team);
        break;
      case 'recon':
        e.next -= dt;
        if (e.next <= 0 && e.pulses > 0) {
          e.pulses--; e.next = e.eff.recon.interval;
          reveal(world, e, e.r, 1.6);
          if (e.pulses === 0) e.ttl = Math.min(e.ttl, 0.5);
        }
        break;
      case 'drone': {
        const d = [e.vx, 0, e.vz], sp = Math.hypot(e.vx, e.vz), step = sp * dt;
        d[0] /= sp; d[2] /= sp;
        if (rayWalls(world, [e.x, e.y, e.z], d, step + 0.4)) done = true; // 壁に当たると壊れる
        else { e.x += d[0] * step; e.z += d[2] * step; }
        e.tick -= dt;
        if (e.tick <= 0) { e.tick += 0.4; reveal(world, e, e.r, 0.9); }
        break;
      }
      case 'orb':
        for (const p of world.players.values()) {
          if (p.alive && p.agent && Math.hypot(p.pos.x - e.x, p.pos.z - e.z) < 1.3 && Math.abs(p.pos.y + 1 - e.y) < 1.5 && p.ult < defsOf(p).x.ult) {
            addUlt(world, p);
            world.emit('effect', { kind: 'orb', x: e.x, y: e.y, z: e.z });
            done = true;
            break;
          }
        }
        break;
      case 'item': break;
      case 'ice': {
        const b = world.boxes.find((bx) => bx.entId === e.id);
        if (!b || b.hp <= 0) { done = true; world.emit('effect', { kind: 'iceBreak', x: e.x, y: e.y + 1, z: e.z }); }
        break;
      }
    }
    if (done) removeEnt(world, i);
  }

  world.marks.length = 0;
  for (const p of world.players.values()) {
    if (p.alive && p.revealUntil > t) world.marks.push({ id: 'm' + p.id, kind: 'mark', x: p.pos.x, y: p.pos.y + 1.1, z: p.pos.z, r: 0, x2: 0, z2: 0, team: p.revealTeam, owner: null });
  }
}

export { createLoadout };
