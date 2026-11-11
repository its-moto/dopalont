import { DEG, clamp, lerp } from '../core/math.js';
import { WEAPONS } from '../data/weapons.js';
import { RULES, PENETRATION } from '../data/rules.js';
import { RUN_SPEED, eyeHeight } from './movement.js';
import { onKill } from './round.js';
import { abilityKill, recallBack } from './abilities.js';

const MAX_RANGE = 400;
const FIRE_BUFFER = 0.08;  // セミオートの先行入力を受け付ける時間

// ヒットボックス (足元基準)。頭は球、胴と脚は箱。しゃがむと全体が低くなる
const HEAD_R = 0.17;
const HEAD_Y = [1.64, 1.1], HIP_Y = [0.85, 0.55], NECK_Y = [1.5, 1.0];
const BODY_HW = 0.3, LEG_HW = 0.26;
const KILL_RESPAWN = { target: 2.5, player: 3 };

export function createLoadout(ids) {
  const out = {};
  for (const slot in ids) {
    const def = WEAPONS[ids[slot]];
    if (!def) continue;
    out[slot] = { def, ammo: def.magSize, reserve: def.reserveAmmo, nextFire: 0, reloadEnd: 0, burstLeft: 0, burstNext: 0 };
  }
  return out;
}

// ---- レイキャスト ----
let _axis = -1, _exit = 0;
function rayBox(o, d, min, max, tMax) {
  let t0 = 0, t1 = Infinity;
  _axis = -1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return -1;
    } else {
      let a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) { t0 = a; _axis = i; }
      if (b < t1) t1 = b;
      if (t0 > t1) return -1;
    }
  }
  if (t0 > tMax) return -1;
  _exit = t1;
  return t0;
}

function raySphere(o, d, cx, cy, cz, r, tMax) {
  const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= tMax ? t : -1;
}

const _min = [0, 0, 0], _max = [0, 0, 0];
function rayPart(o, d, pos, hw, y0, y1, tMax) {
  _min[0] = pos.x - hw; _min[1] = pos.y + y0; _min[2] = pos.z - hw;
  _max[0] = pos.x + hw; _max[1] = pos.y + y1; _max[2] = pos.z + hw;
  return rayBox(o, d, _min, _max, tMax);
}

/** 人型 1 体との交差。当たった部位を hit に書く */
function rayBody(o, d, ent, pos, crouch, hit) {
  const headY = lerp(HEAD_Y[0], HEAD_Y[1], crouch), hip = lerp(HIP_Y[0], HIP_Y[1], crouch), neck = lerp(NECK_Y[0], NECK_Y[1], crouch);
  let t = raySphere(o, d, pos.x, pos.y + headY, pos.z, HEAD_R, hit.t);
  let part = 'head';
  const tb = rayPart(o, d, pos, BODY_HW, hip, neck, hit.t);
  if (tb >= 0 && (t < 0 || tb < t)) { t = tb; part = 'body'; }
  const tl = rayPart(o, d, pos, LEG_HW, 0, hip, hit.t);
  if (tl >= 0 && (t < 0 || tl < t)) { t = tl; part = 'leg'; }
  if (t >= 0 && t < hit.t) {
    hit.t = t; hit.kind = 'ent'; hit.ent = ent; hit.part = part; hit.normal = null; hit.mat = null;
  }
}

/** a から b までの間に壁があるか */
export function blocked(boxes, a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return false;
  d[0] /= len; d[1] /= len; d[2] /= len;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(a, d, boxes[i].min, boxes[i].max, len);
    if (t >= 0 && _axis >= 0) return true;
  }
  return false;
}

/** 壁だけを相手にしたレイ。当たれば { t, normal }、なければ null (投げ物の移動などに使う) */
export function rayWalls(world, o, d, maxDist) {
  const boxes = world.boxes;
  let best = maxDist, axis = -2;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(o, d, boxes[i].min, boxes[i].max, best);
    if (t >= 0 && t < best) { best = t; axis = _axis; }
  }
  if (axis === -2) return null;
  const normal = [0, 0, 0];
  if (axis >= 0) normal[axis] = d[axis] > 0 ? -1 : 1; else normal[1] = 1;
  return { t: best, normal };
}

/**
 * ダメージを与える共通の入口 (銃もアビリティもここを通る)。倒したら true
 * attacker は null でもよい (持ち主が抜けた後の炎など)
 */
export function damageEntity(world, attacker, ent, damage, part, point, weapon, through = false) {
  if (!ent.alive || damage <= 0) return false;
  let killed = applyDamage(ent, damage);
  if (killed && ent.recall) { recallBack(world, ent); killed = false; } // リワインド中はやられても戻る
  world.emit('hit', { playerId: attacker ? attacker.id : null, victimId: ent.id, part, damage, killed, point, through });
  if (!killed) return false;
  ent.alive = false;
  ent.respawnAt = world.time + (ent.isTarget ? KILL_RESPAWN.target : KILL_RESPAWN.player);
  if (!ent.isTarget) {
    ent.deathPos = { x: ent.pos.x, y: ent.pos.y, z: ent.pos.z };
    ent.deaths++;
    if (attacker && attacker !== ent) attacker.kills++;
    onKill(world, attacker, ent);
    abilityKill(world, attacker, ent);
  }
  world.emit('kill', { playerId: attacker ? attacker.id : null, victimId: ent.id, headshot: part === 'head', weapon });
  return true;
}

const _rw = { x: 0, y: 0, z: 0, crouch: 0 };

/**
 * 壁・的・敵プレイヤーに対する最も近い命中を返す
 * shooter を渡すと、本人と味方を除外し、敵は shooter.lagComp 秒前の位置で判定する
 * 壁に当たった場合、exit はその壁を抜けるまでの距離 (壁抜きの判定に使う)
 */
export function raycast(world, o, d, shooter = null, maxDist = MAX_RANGE) {
  const hit = { t: maxDist, kind: 'none', normal: null, mat: null, ent: null, part: null, exit: 0, box: null };
  const boxes = world.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(o, d, boxes[i].min, boxes[i].max, hit.t);
    if (t < 0 || t >= hit.t) continue;
    hit.t = t; hit.kind = 'wall'; hit.mat = boxes[i].mat; hit.exit = _exit; hit.box = boxes[i];
    hit.normal = [0, 0, 0];
    if (_axis >= 0) hit.normal[_axis] = d[_axis] > 0 ? -1 : 1;
    else hit.normal[1] = 1; // 始点が箱の中 (壁抜きの 2 本目のレイ): 抜けられない壁として扱う
  }
  for (const tg of world.targets) {
    if (tg.alive) rayBody(o, d, tg, tg.pos, 0, hit);
  }
  for (const pl of world.players.values()) {
    if (pl === shooter || !pl.alive) continue;
    if (shooter && shooter.team && pl.team === shooter.team) continue; // フレンドリーファイアなし
    world.rewound(pl, shooter ? shooter.lagComp : 0, _rw);
    rayBody(o, d, pl, _rw, _rw.crouch, hit);
  }
  return hit;
}

// ---- ダメージ ----
export function damageFor(def, part, dist) {
  for (const band of def.damage) if (dist <= band.maxRange) return band[part];
  return def.damage[def.damage.length - 1][part];
}

/** アーマーが 66% を肩代わりする。死んだら true */
export function applyDamage(ent, dmg) {
  const absorbed = Math.min(ent.armor, Math.floor(dmg * RULES.armorAbsorb));
  ent.armor -= absorbed;
  ent.hp -= dmg - absorbed;
  return ent.hp <= 0;
}

// ---- 拡散 ----
function computeSpread(p, def, idx) {
  const s = def.spread;
  const scoped = !def.ads || !def.ads.scope || p.ads;
  let v;
  if (!p.onGround) {
    v = s.air;
  } else {
    const r = Math.hypot(p.vel.x, p.vel.z) / (RUN_SPEED * def.moveSpeedMul);
    const still = idx === 0 ? s.first : Math.min(s.max, s.stand + s.perShot * idx);
    const walk = Math.max(still, s.walk), run = Math.max(still, s.run);
    if (r < 0.25) v = still;
    else if (r < 0.56) v = lerp(still, walk, (r - 0.25) / 0.31);
    else v = lerp(walk, run, clamp((r - 0.56) / 0.44, 0, 1));
    if (p.crouch > 0.5) v *= s.crouchMul;
  }
  if (!scoped) v = Math.max(v, s.hip); // スナイパーは覗かないと当たらない
  if (p.ads) v *= def.ads.spreadMul;
  return v;
}

function fireShot(world, p, w, forcedSpread) {
  const def = w.def, idx = p.sprayIndex;
  const spread = (forcedSpread || computeSpread(p, def, idx)) * DEG;
  const yaw = p.yaw + p.recoil.yaw;
  const pitch = clamp(p.pitch + p.recoil.pitch, -1.55, 1.55);
  const o = [p.pos.x, p.pos.y + eyeHeight(p), p.pos.z];
  const range = def.melee ? def.range : MAX_RANGE;
  const impacts = [];

  const range0 = def.range || range;
  for (let i = 0; i < def.pellets; i++) {
    const a = world.rng() * Math.PI * 2, m = spread * Math.sqrt(world.rng());
    const y2 = yaw + Math.cos(a) * m, p2 = pitch + Math.sin(a) * m, cp = Math.cos(p2);
    const d = [-Math.sin(y2) * cp, Math.sin(p2), -Math.cos(y2) * cp];

    if (def.pierceAll) { // 壁を無視して、線上の敵すべてに当たる
      impacts.push({ point: [o[0] + d[0] * range0, o[1] + d[1] * range0, o[2] + d[2] * range0], kind: 'none', normal: null, mat: null });
      for (const pl of [...world.players.values(), ...world.targets]) {
        if (pl === p || !pl.alive || (p.team && pl.team === p.team)) continue;
        const h = { t: range0, kind: 'none' };
        if (pl.isTarget) rayBody(o, d, pl, pl.pos, 0, h);
        else { world.rewound(pl, p.lagComp, _rw); rayBody(o, d, pl, _rw, _rw.crouch, h); }
        if (h.kind !== 'ent') continue;
        const pt = [o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t];
        if (damageEntity(world, p, pl, damageFor(def, h.part, h.t), h.part, pt, def.id, true) && def.refreshOnKill) w.ammo = def.magSize + 1;
      }
      continue;
    }

    let hit = raycast(world, o, d, p, range), dist = hit.t, mul = 1;
    if (hit.kind === 'wall' && hit.box.kind === 'dyn') hit.box.hp -= damageFor(def, 'body', dist); // 氷の壁は撃てば壊れる
    impacts.push({ point: [o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist], kind: hit.kind, normal: hit.normal, mat: hit.mat });

    // 壁抜き: 薄い壁なら 1 枚だけ抜けて、威力を落として奥の敵に当たる
    if (hit.kind === 'wall' && !def.melee) {
      const pen = PENETRATION[def.penetration];
      if (hit.exit - hit.t <= pen.thick) {
        const skip = hit.exit + 0.02;
        const o2 = [o[0] + d[0] * skip, o[1] + d[1] * skip, o[2] + d[2] * skip];
        const h2 = raycast(world, o2, d, p, range - skip);
        if (h2.kind === 'ent') { hit = h2; dist = skip + h2.t; mul = pen.mul; }
      }
    }

    if (hit.kind === 'ent') {
      const point = [o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist];
      const killed = damageEntity(world, p, hit.ent, Math.round(damageFor(def, hit.part, dist) * mul), hit.part, point, def.id, mul < 1);
      if (killed && def.refreshOnKill) w.ammo = def.magSize + 1; // この後の 1 発ぶんの消費を見越して満タンに
    }
  }

  if (!def.melee) w.ammo--;
  p.sprayIndex = idx + 1;
  p.lastShotTime = world.time;
  const pat = def.recoil.pattern;
  const r = pat[Math.min(idx + 1, pat.length - 1)];
  p.recoil.yaw = r[0] * DEG;
  p.recoil.pitch = r[1] * DEG;
  world.emit('shot', { playerId: p.id, weapon: def.id, origin: o, impacts });
}

function startReload(world, p, w) {
  if (w.def.melee || w.reloadEnd || w.ammo >= w.def.magSize || w.reserve <= 0) return;
  w.reloadEnd = world.time + w.def.reloadTime;
  w.burstLeft = 0;
  world.emit('reloadStart', { playerId: p.id, weapon: w.def.id, dur: w.def.reloadTime });
}

export function stepCombat(world, p, inp, dt) {
  const t = world.time;

  if (inp.slot && inp.slot !== p.slot && p.weapons[inp.slot]) {
    const old = p.weapons[p.slot];
    if (old) { old.reloadEnd = 0; old.burstLeft = 0; }
    p.slot = inp.slot;
    const nw = p.weapons[p.slot];
    p.equipUntil = t + nw.def.equipTime;
    p.sprayIndex = 0;
    p.recoil.yaw = 0; p.recoil.pitch = 0;
    world.emit('equip', { playerId: p.id, weapon: nw.def.id, dur: nw.def.equipTime });
  }

  const w = p.weapons[p.slot], def = w.def;

  if (w.reloadEnd && t >= w.reloadEnd) {
    const take = Math.min(def.magSize - w.ammo, w.reserve);
    w.ammo += take;
    if (!world.infiniteReserve) w.reserve -= take;
    w.reloadEnd = 0;
    world.emit('reloadEnd', { playerId: p.id, weapon: def.id });
  }

  // 撃ち止めると照準が戻り、連射カウントがリセットされる
  const rec = def.recoil, since = t - p.lastShotTime;
  if (since > rec.recoverDelay) {
    const k = Math.exp(-rec.recoverRate * dt);
    p.recoil.yaw *= k; p.recoil.pitch *= k;
  }
  if (since > rec.resetTime) p.sprayIndex = 0;

  // 設置・解除の最中は撃てない
  const ready = t >= p.equipUntil && !w.reloadEnd && !p.acting;
  p.ads = !!(def.ads && inp.alt && ready);
  p.moveMul = def.moveSpeedMul * (p.ads ? def.ads.moveMul : 1);

  const fireEdge = inp.fire && !p.prevFire, altEdge = inp.alt && !p.prevAlt;
  if (fireEdge) p.fireBuffer = t + FIRE_BUFFER;
  if (inp.reload && ready) startReload(world, p, w);

  if (ready && !w.reloadEnd) {
    if (w.burstLeft > 0) {
      if (t >= w.burstNext) {
        fireShot(world, p, w, def.alt.spread);
        w.burstLeft = w.ammo > 0 ? w.burstLeft - 1 : 0;
        w.burstNext = t + def.alt.interval;
      }
    } else if (t >= w.nextFire) {
      const trigger = def.fireMode === 'auto' ? inp.fire : t <= p.fireBuffer;
      if (trigger) {
        p.fireBuffer = 0;
        if (w.ammo > 0) {
          // ヘビー武器は撃ち続けるほど速くなる
          let rate = def.rampTo ? lerp(def.fireRate, def.rampTo, Math.min(1, p.sprayIndex / def.rampShots)) : def.fireRate;
          if (p.ads) rate *= def.ads.fireRateMul;
          rate *= p.rateMul || 1; // ラリービーコンの中
          fireShot(world, p, w, 0);
          // tick の端数を持ち越して、連射速度を正確に保つ
          w.nextFire = t - w.nextFire < dt ? w.nextFire + 1 / rate : t + 1 / rate;
        } else {
          if (fireEdge) world.emit('dry', { playerId: p.id });
          startReload(world, p, w);
        }
      } else if (altEdge && def.alt && w.ammo > 0) {
        w.burstLeft = Math.min(def.alt.count, w.ammo);
        w.burstNext = t;
        w.nextFire = t + def.alt.cooldown;
      }
    }
  }

  p.prevFire = inp.fire;
  p.prevAlt = inp.alt;
}
