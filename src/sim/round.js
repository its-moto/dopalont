import { RULES } from '../data/rules.js';
import { WEAPONS } from '../data/weapons.js';
import { createLoadout } from './combat.js';
import { roundAbilities, buyAbility, sellAbility, addUlt } from './abilities.js';
import { dropOnDeath } from './items.js';

// ラウンドの進行・スパイク・経済・購入 (DESIGN.md §4)。ホストの sim だけが動かす
//
// world.round = {
//   phase: 'buy' | 'live' | 'planted' | 'end' | 'over', timer, number, half, overtime,
//   score: { attack, defense }, loss: { attack, defense } (連敗数),
//   winner, reason, matchWinner, winsNeeded,
//   spike: { state: 'none'|'carried'|'dropped'|'planted'|'defused'|'exploded', carrier, x, y, z, plant, defuse, user, site },
// }
// チーム名 (attack / defense) は「今どちら側か」を表す。攻守交代ではプレイヤーのチームとスコアを入れ替える

const SIDES = ['attack', 'defense'];
const other = (side) => (side === 'attack' ? 'defense' : 'attack');
const startLoadout = () => ({ sidearm: 'pistol_basic', melee: 'knife' });

export function initRounds(world, { winsNeeded = RULES.winsNeeded } = {}) {
  world.round = {
    phase: 'buy', timer: RULES.buyTimeFirst, number: 1, half: 1, overtime: false, freshAll: true,
    score: { attack: 0, defense: 0 }, loss: { attack: 0, defense: 0 },
    winner: null, reason: '', matchWinner: null, winsNeeded,
    spike: { state: 'none', carrier: null, x: 0, y: 0, z: 0, plant: 0, defuse: 0, user: null, site: null },
  };
}

const members = (world, side) => [...world.players.values()].filter((p) => p.team === side);
const aliveCount = (list) => list.reduce((n, p) => n + (p.alive ? 1 : 0), 0);

function addCredits(p, n) { p.credits = Math.min(RULES.maxCredits, p.credits + n); }

export function emitInv(world, p) {
  const am = (slot) => (p.weapons[slot] ? [p.weapons[slot].ammo, p.weapons[slot].reserve] : null);
  world.emit('inv', { playerId: p.id, credits: p.credits, armor: p.armor, primary: p.loadout.primary || null, sidearm: p.loadout.sidearm || null, ult: p.loadout.ult || null,
    ammo: { primary: am('primary'), sidearm: am('sidearm') } }); // ammo: 拾った武器の残弾を参加側に伝える
}

/** 今持てる中で一番良い武器のスロット */
export const bestSlot = (p) => (p.weapons.primary ? 'primary' : p.weapons.sidearm ? 'sidearm' : 'melee');

/** 武器スロットの中身を入れ替える (id が null なら外す) */
export function setSlot(p, slot, id) {
  if (id) {
    p.loadout[slot] = id;
    p.weapons[slot] = createLoadout({ [slot]: id })[slot];
    p.slot = slot;
    p.equipUntil = 0;
  } else {
    delete p.loadout[slot];
    delete p.weapons[slot];
  }
  if (!p.weapons[p.slot]) p.slot = bestSlot(p);
  p.sprayIndex = 0;
  p.prevFire = true; // 持ち替えた瞬間に、押しっぱなしのボタンで撃ってしまわないように
  p.recoil.yaw = p.recoil.pitch = 0;
}

/** 参加側: ホストから届いた所持品を自分の状態に反映する */
export function applyInv(p, e) {
  p.credits = e.credits;
  p.armor = e.armor;
  for (const slot of ['primary', 'sidearm', 'ult']) {
    if ((p.loadout[slot] || null) !== (e[slot] || null)) {
      setSlot(p, slot, e[slot] || null);
      const am = e.ammo && e.ammo[slot];
      if (am && p.weapons[slot]) { p.weapons[slot].ammo = am[0]; p.weapons[slot].reserve = am[1]; }
    }
  }
}

/** 試合の途中から入った人。購入フェーズ中ならすぐ出現、それ以外は次のラウンドから */
export function joinRound(world, p) {
  const r = world.round;
  p.credits = r.overtime ? RULES.overtimeCredits : RULES.startCredits;
  p.loadout = startLoadout();
  p.armor = 0;
  p.bought = {};
  if (r.phase === 'buy') world.spawn(p);
  else { p.alive = false; p.fresh = true; }
  emitInv(world, p);
}

export function startRound(world) {
  const r = world.round;
  r.phase = 'buy';
  r.timer = r.freshAll ? RULES.buyTimeFirst : RULES.buyTime;
  r.winner = null; r.reason = '';
  roundAbilities(world);

  const pts = {}, next = { attack: 0, defense: 0 };
  for (const side of SIDES) { // スポーン地点を混ぜて、重ならないように配る
    const list = world.map.spawns[side].slice();
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(world.rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    pts[side] = list;
  }

  const teams = {};
  for (const p of world.players.values()) {
    teams[p.id] = p.team;
    if (!pts[p.team]) continue;
    // やられた人は武器とアーマーを失う。生き残った人は持ち越す
    if (r.freshAll || !p.alive || p.fresh) { p.loadout = startLoadout(); p.armor = 0; }
    if (!p.loadout.sidearm) p.loadout.sidearm = 'pistol_basic'; // サブ武器を手放していたら、最初のピストルが支給される
    if (r.freshAll) p.credits = r.overtime ? RULES.overtimeCredits : RULES.startCredits;
    p.fresh = false; p.bought = {}; p.acting = null;
    world.spawn(p, pts[p.team][next[p.team]++ % pts[p.team].length]);
    emitInv(world, p);
  }
  r.freshAll = false;

  // スパイクは攻撃スポーンの真ん中に落ちている。攻撃側の誰かが上を通って拾う
  const sp = world.map.spawns.attack;
  const cx = sp.reduce((a, q) => a + q.x, 0) / sp.length, cz = sp.reduce((a, q) => a + q.z, 0) / sp.length;
  Object.assign(r.spike, { state: 'dropped', carrier: null, x: cx, y: 0, z: cz, plant: 0, defuse: 0, user: null, site: null, noPick: null, noPickUntil: 0 });
  world.emit('roundStart', { n: r.number, teams, carrier: null });
}

function endRound(world, side, reason) {
  const r = world.round;
  if (r.phase === 'end' || r.phase === 'over') return;
  r.phase = 'end'; r.timer = RULES.endTime; r.winner = side; r.reason = reason;
  r.score[side]++;
  const loser = other(side);
  for (const p of world.players.values()) {
    if (p.team === side) addCredits(p, RULES.winCredits);
    else if (p.team === loser) addCredits(p, RULES.lossCredits[r.loss[loser]]);
    else continue;
    p.acting = null;
    emitInv(world, p);
  }
  r.loss[loser] = Math.min(RULES.lossCredits.length - 1, r.loss[loser] + 1);
  r.loss[side] = 0;
  r.spike.user = null;
  world.emit('roundEnd', { winner: side, reason, score: { ...r.score } });
}

function swapSides(world) {
  const r = world.round;
  for (const p of world.players.values()) if (p.team === 'attack' || p.team === 'defense') p.team = other(p.team);
  [r.score.attack, r.score.defense] = [r.score.defense, r.score.attack];
  r.loss.attack = r.loss.defense = 0;
}

function nextRound(world) {
  const r = world.round, W = r.winsNeeded, a = r.score.attack, d = r.score.defense;
  if (Math.max(a, d) >= W && Math.abs(a - d) >= 2) {
    r.phase = 'over';
    r.matchWinner = a > d ? 'attack' : 'defense';
    world.emit('matchEnd', { winner: r.matchWinner, score: { ...r.score } });
    return;
  }
  r.number++;
  if (a >= W - 1 && d >= W - 1) { // 延長戦: 2 差がつくまで、毎ラウンド攻守交代
    r.overtime = true; r.freshAll = true;
    swapSides(world);
  } else if (a + d === W - 1) {   // ハーフタイム
    r.half = 2; r.freshAll = true;
    swapSides(world);
  }
  startRound(world);
}

function siteAt(world, p) {
  for (const name in world.map.sites) {
    const s = world.map.sites[name];
    if (p.pos.x >= s.min[0] && p.pos.x <= s.max[0] && p.pos.z >= s.min[1] && p.pos.z <= s.max[1]) return name;
  }
  return null;
}

function dropSpike(world, p) {
  dropSpikeAt(world, p, p.pos.x, p.pos.z);
  world.round.spike.noPick = null;
}

/** スパイクを (x, z) に置く。置いた本人はしばらく拾い直せない (G キーで味方に渡す時) */
export function dropSpikeAt(world, p, x, z) {
  const s = world.round.spike;
  s.state = 'dropped'; s.carrier = null; s.plant = 0; s.user = null;
  s.x = x; s.y = p.pos.y; s.z = z;
  s.noPick = p.id; s.noPickUntil = world.time + 1.5;
  p.acting = null;
  world.emit('spikeDrop', { playerId: p.id });
}

function pickupSpike(world) {
  const s = world.round.spike;
  if (s.state !== 'dropped') return;
  for (const p of world.players.values()) {
    if (!p.alive || p.team !== 'attack') continue;
    if (s.noPick === p.id && world.time < s.noPickUntil) continue;
    if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > RULES.pickupRange || Math.abs(p.pos.y - s.y) > 1.5) continue;
    s.state = 'carried'; s.carrier = p.id;
    world.emit('spikePickup', { playerId: p.id });
    return;
  }
}

/** キルが起きた時に combat から呼ばれる。killer が null ならスパイクの爆発 */
export function onKill(world, killer, victim) {
  const r = world.round;
  if (!r) return;
  if (killer && killer.team !== victim.team) { addCredits(killer, RULES.killCredits); emitInv(world, killer); }
  victim.acting = null;
  if (r.spike.state === 'carried' && r.spike.carrier === victim.id) dropSpike(world, victim);
  dropOnDeath(world, victim);
}

/** プレイヤーが抜けた時 */
export function onLeave(world, p) {
  const r = world.round;
  if (r && r.spike.state === 'carried' && r.spike.carrier === p.id) dropSpike(world, p);
}

export function stepRound(world, dt) {
  const r = world.round, s = r.spike;
  if (r.phase === 'over') return;
  r.timer -= dt;
  if (r.phase !== 'end') pickupSpike(world); // 購入フェーズ中でも拾える

  if (r.phase === 'buy') {
    if (r.timer <= 0) { r.phase = 'live'; r.timer = RULES.roundTime; world.emit('phase', { phase: 'live' }); }
    return;
  }
  if (r.phase === 'end') {
    if (r.timer <= 0) nextRound(world);
    return;
  }

  const attackers = members(world, 'attack'), defenders = members(world, 'defense');

  // ---- 設置 (サイト内で F を押し続ける) ----
  if (r.phase === 'live' && s.state === 'carried') {
    const c = world.players.get(s.carrier);
    const site = c && c.alive && c.lastCmd.use && c.onGround ? siteAt(world, c) : null;
    if (site) {
      if (c.acting !== 'plant') world.emit('plantStart', { playerId: c.id });
      c.acting = 'plant'; s.user = c.id;
      s.plant += dt;
      if (s.plant >= RULES.plantTime) {
        c.acting = null;
        Object.assign(s, { state: 'planted', carrier: null, user: null, plant: 0, defuse: 0, site, x: c.pos.x, y: c.pos.y, z: c.pos.z });
        r.phase = 'planted'; r.timer = RULES.spikeTime;
        for (const p of attackers) { addCredits(p, RULES.plantCredits); emitInv(world, p); }
        addUlt(world, c);
        world.emit('plant', { playerId: c.id, site });
      }
    } else {
      if (c) c.acting = null;
      s.plant = 0; s.user = null;
    }
  }

  // ---- 解除 (スパイクのそばで F を押し続ける) ----
  if (r.phase === 'planted') {
    let user = null;
    for (const p of defenders) {
      const can = p.alive && p.lastCmd.use && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) <= RULES.defuseRange && Math.abs(p.pos.y - s.y) < 1.5;
      if (can && (!user || p.id === s.user)) user = p;
      else if (p.acting === 'defuse') p.acting = null;
    }
    if (user) {
      if (s.user !== user.id) world.emit('defuseStart', { playerId: user.id });
      user.acting = 'defuse'; s.user = user.id;
      s.defuse += dt;
      if (s.defuse >= RULES.defuseTime) {
        user.acting = null;
        s.state = 'defused'; s.user = null;
        addUlt(world, user);
        world.emit('defuse', { playerId: user.id });
        endRound(world, 'defense', 'defuse');
        return;
      }
    } else {
      s.user = null;
      s.defuse = s.defuse >= RULES.defuseHalf ? RULES.defuseHalf : 0; // 半分を越えていれば、そこから再開できる
    }

    if (r.timer <= 0) { // 爆発
      s.state = 'exploded';
      world.emit('explode', { x: s.x, y: s.y, z: s.z });
      for (const p of world.players.values()) {
        if (!p.alive || Math.hypot(p.pos.x - s.x, p.pos.z - s.z) > RULES.blastRadius) continue;
        p.alive = false; p.hp = 0; p.deaths++; p.recall = null;
        p.deathPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
        world.emit('kill', { playerId: null, victimId: p.id, headshot: false, weapon: 'spike' });
      }
      endRound(world, 'attack', 'explode');
      return;
    }
  }

  // ---- 全滅と時間切れ ----
  const aAlive = aliveCount(attackers), dAlive = aliveCount(defenders);
  if (defenders.length && dAlive === 0) endRound(world, 'attack', 'elim');
  else if (r.phase === 'live') {
    if (attackers.length && aAlive === 0) endRound(world, 'defense', 'elim');
    else if (r.timer <= 0) endRound(world, 'defense', 'time');
  }
  // 設置後は、攻撃側が全滅しても解除するまで終わらない
}

// ---- 購入 ----
// p.bought[slot] = { price, prev }: このラウンドに買った物。買い直しや売却で全額戻る

function canShop(world, p) {
  return world.round && world.round.phase === 'buy' && p.alive;
}

export function buy(world, p, item) {
  if (!canShop(world, p)) return false;
  if (item.startsWith('ab:')) return buyAbility(world, p, item.slice(3)); // アビリティの回数
  const armor = RULES.armor[item], def = WEAPONS[item];
  if (!armor && !(def && (def.slot === 'primary' || def.slot === 'sidearm'))) return false;
  const slot = armor ? 'armor' : def.slot, price = armor ? armor.price : def.price;
  const old = p.bought[slot];
  const have = p.credits + (old ? old.price : 0);
  if (price > have) return false;
  if (armor ? p.armor === armor.value && old : p.loadout[slot] === item) return false;
  const prev = old ? old.prev : armor ? p.armor : p.loadout[slot] || null;
  if (armor && !old && p.armor >= armor.value) return false; // 既にそれ以上のアーマーを着ている
  p.credits = have - price;
  p.bought[slot] = { price, prev };
  if (armor) p.armor = armor.value;
  else setSlot(p, slot, item);
  if (price === 0) delete p.bought[slot];
  emitInv(world, p);
  return true;
}

export function sell(world, p, slot) {
  if (!canShop(world, p)) return false;
  if (slot.startsWith('ab:')) return sellAbility(world, p, slot.slice(3));
  const old = p.bought[slot];
  if (!old) return false;
  p.credits += old.price;
  delete p.bought[slot];
  if (slot === 'armor') p.armor = old.prev;
  else setSlot(p, slot, old.prev || (slot === 'sidearm' ? 'pistol_basic' : null));
  emitInv(world, p);
  return true;
}
