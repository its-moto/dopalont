import { DEG, clamp, lerp } from '../core/math.js';
import { WEAPONS } from '../data/weapons.js';
import { RUN_SPEED, eyeHeight } from './movement.js';

const MAX_RANGE = 400;
const ARMOR_ABSORB = 0.66; // DESIGN.md §4.4
const FIRE_BUFFER = 0.08;  // セミオートの先行入力を受け付ける時間

// ヒットボックス (足元基準)。頭は球、胴と脚は箱
const HEAD_R = 0.17, HEAD_Y = 1.64;
const BODY = { hw: 0.3, y0: 0.85, y1: 1.5 };
const LEGS = { hw: 0.26, y0: 0, y1: 0.85 };

export function createLoadout(ids) {
  const out = {};
  for (const slot in ids) {
    const def = WEAPONS[ids[slot]];
    out[slot] = { def, ammo: def.magSize, reserve: def.reserveAmmo, nextFire: 0, reloadEnd: 0, burstLeft: 0, burstNext: 0 };
  }
  return out;
}

// ---- レイキャスト ----
let _axis = -1;
function rayBox(o, d, min, max, tMax) {
  let t0 = 0, t1 = tMax;
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
function rayPart(o, d, pos, part, tMax) {
  _min[0] = pos.x - part.hw; _min[1] = pos.y + part.y0; _min[2] = pos.z - part.hw;
  _max[0] = pos.x + part.hw; _max[1] = pos.y + part.y1; _max[2] = pos.z + part.hw;
  return rayBox(o, d, _min, _max, tMax);
}

/** 壁と的に対する最も近い命中を返す */
export function raycast(world, o, d, maxDist = MAX_RANGE) {
  const hit = { t: maxDist, kind: 'none', normal: null, mat: null, target: null, part: null };
  const boxes = world.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(o, d, boxes[i].min, boxes[i].max, hit.t);
    if (t >= 0 && t < hit.t && _axis >= 0) {
      hit.t = t; hit.kind = 'wall'; hit.mat = boxes[i].mat;
      hit.normal = [0, 0, 0];
      hit.normal[_axis] = d[_axis] > 0 ? -1 : 1;
    }
  }
  for (const tg of world.targets) {
    if (!tg.alive) continue;
    let t = raySphere(o, d, tg.pos.x, tg.pos.y + HEAD_Y, tg.pos.z, HEAD_R, hit.t);
    let part = 'head';
    const tb = rayPart(o, d, tg.pos, BODY, hit.t);
    if (tb >= 0 && (t < 0 || tb < t)) { t = tb; part = 'body'; }
    const tl = rayPart(o, d, tg.pos, LEGS, hit.t);
    if (tl >= 0 && (t < 0 || tl < t)) { t = tl; part = 'leg'; }
    if (t >= 0 && t < hit.t) {
      hit.t = t; hit.kind = 'target'; hit.target = tg; hit.part = part; hit.normal = null; hit.mat = null;
    }
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
  const absorbed = Math.min(ent.armor, Math.floor(dmg * ARMOR_ABSORB));
  ent.armor -= absorbed;
  ent.hp -= dmg - absorbed;
  return ent.hp <= 0;
}

// ---- 拡散 ----
function computeSpread(p, def, idx) {
  const s = def.spread;
  let v;
  if (!p.onGround) {
    v = s.air;
  } else {
    const r = Math.hypot(p.vel.x, p.vel.z) / RUN_SPEED;
    const still = idx === 0 ? s.first : Math.min(s.max, s.stand + s.perShot * idx);
    const walk = Math.max(still, s.walk), run = Math.max(still, s.run);
    if (r < 0.25) v = still;
    else if (r < 0.56) v = lerp(still, walk, (r - 0.25) / 0.31);
    else v = lerp(walk, run, clamp((r - 0.56) / 0.44, 0, 1));
    if (p.crouch > 0.5) v *= s.crouchMul;
  }
  if (p.ads) v *= def.ads.spreadMul;
  return v;
}

function fireShot(world, p, w, forcedSpread) {
  const def = w.def, idx = p.sprayIndex;
  const spread = (forcedSpread || computeSpread(p, def, idx)) * DEG;
  const yaw = p.yaw + p.recoil.yaw;
  const pitch = clamp(p.pitch + p.recoil.pitch, -1.55, 1.55);
  const o = [p.pos.x, p.pos.y + eyeHeight(p), p.pos.z];
  const impacts = [];

  for (let i = 0; i < def.pellets; i++) {
    const a = world.rng() * Math.PI * 2, m = spread * Math.sqrt(world.rng());
    const y2 = yaw + Math.cos(a) * m, p2 = pitch + Math.sin(a) * m, cp = Math.cos(p2);
    const d = [-Math.sin(y2) * cp, Math.sin(p2), -Math.cos(y2) * cp];
    const hit = raycast(world, o, d);
    const point = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t];
    impacts.push({ point, kind: hit.kind, normal: hit.normal, mat: hit.mat });
    if (hit.kind === 'target') {
      const tg = hit.target;
      const damage = damageFor(def, hit.part, hit.t);
      const killed = applyDamage(tg, damage);
      world.emit('hit', { playerId: p.id, targetId: tg.id, part: hit.part, damage, killed, point });
      if (killed) {
        tg.alive = false;
        tg.respawnAt = world.time + 2.5;
        world.emit('kill', { playerId: p.id, targetId: tg.id, headshot: hit.part === 'head', weapon: def.id });
      }
    }
  }

  w.ammo--;
  p.sprayIndex = idx + 1;
  p.lastShotTime = world.time;
  const pat = def.recoil.pattern;
  const r = pat[Math.min(idx + 1, pat.length - 1)];
  p.recoil.yaw = r[0] * DEG;
  p.recoil.pitch = r[1] * DEG;
  world.emit('shot', { playerId: p.id, weapon: def.id, origin: o, impacts });
}

function startReload(world, p, w) {
  if (w.reloadEnd || w.ammo >= w.def.magSize || w.reserve <= 0) return;
  w.reloadEnd = world.time + w.def.reloadTime;
  w.burstLeft = 0;
  world.emit('reloadStart', { playerId: p.id, weapon: w.def.id, dur: w.def.reloadTime });
}

export function stepCombat(world, p, inp, dt) {
  const t = world.time;

  if (inp.slot && inp.slot !== p.slot && p.weapons[inp.slot]) {
    const old = p.weapons[p.slot];
    old.reloadEnd = 0; old.burstLeft = 0;
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

  const ready = t >= p.equipUntil && !w.reloadEnd;
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
          fireShot(world, p, w, 0);
          const iv = 1 / (def.fireRate * (p.ads ? def.ads.fireRateMul : 1));
          // tick の端数を持ち越して、連射速度を正確に保つ
          w.nextFire = t - w.nextFire < dt ? w.nextFire + iv : t + iv;
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
