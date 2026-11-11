import { WEAPONS } from '../data/weapons.js';
import { addEnt } from './abilities.js';
import { rayWalls } from './combat.js';
import { setSlot, emitInv, dropSpikeAt } from './round.js';
import { floorAt } from './map.js';

// 床に落ちている武器 (world.ents の kind: 'item') と、G キーのドロップ・F キーの拾い
// item: { w: 武器 ID, ammo, reserve, dropper: 落とした人, noPickUntil: 落とした本人が拾い直せる時刻 }

const PICK_RANGE = 1.7;   // F で拾える距離
const AUTO_RANGE = 1.0;   // そのスロットが空なら、上を通るだけで拾う
const DROP_DIST = 1.3;    // 前に放る距離
const REPICK = 1.5;       // 落とした本人が拾い直せるまでの秒数

/** 前方の床の位置。壁があれば足元 */
function dropPoint(world, p) {
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const hit = rayWalls(world, [p.pos.x, p.pos.y + 1, p.pos.z], [fx, 0, fz], DROP_DIST + 0.4);
  const x = p.pos.x + fx * DROP_DIST, z = p.pos.z + fz * DROP_DIST;
  if (hit || floorAt(world.map, x, z) < 0) return { x: p.pos.x, z: p.pos.z };
  return { x, z };
}

/** 武器を床に落とす。at を省くと前方に放る */
export function dropWeapon(world, p, slot, at = null) {
  const w = p.weapons[slot];
  if (!w || (slot !== 'primary' && slot !== 'sidearm')) return false;
  const pt = at || dropPoint(world, p);
  addEnt(world, { kind: 'item', x: pt.x, y: p.pos.y, z: pt.z, r: 0.4, w: w.def.id, ammo: w.ammo, reserve: w.reserve,
    dropper: p.id, noPickUntil: world.time + REPICK, ttl: Infinity });
  setSlot(p, slot, null);
  delete p.bought[slot]; // 落とした物は売却できない (味方に渡してから返金、を防ぐ)
  if (world.round) emitInv(world, p);
  world.emit('drop', { playerId: p.id, weapon: w.def.id });
  return true;
}

/** G キー: ナイフを持っていてスパイクを運んでいればスパイクを、そうでなければ持っている武器を落とす */
export function dropHeld(world, p) {
  if (!p.alive || p.acting) return false;
  const s = world.round && world.round.spike;
  if (p.slot === 'melee') {
    if (!s || s.state !== 'carried' || s.carrier !== p.id) return false;
    const pt = dropPoint(world, p);
    dropSpikeAt(world, p, pt.x, pt.z);
    return true;
  }
  return dropWeapon(world, p, p.slot);
}

/** やられた時: 持っていた武器をその場に落とす (最初のピストルは落とさない) */
export function dropOnDeath(world, p) {
  const at = { x: p.pos.x, z: p.pos.z };
  if (p.weapons.primary) dropWeapon(world, p, 'primary', at);
  else if (p.weapons.sidearm && p.weapons.sidearm.def.price > 0) dropWeapon(world, p, 'sidearm', at);
}

/** 毎 tick: 落ちている武器を拾う */
export function stepItems(world) {
  for (const p of world.players.values()) {
    const use = !!p.lastCmd.use, edge = use && !p.prevUse;
    p.prevUse = use;
    if (!p.alive || p.acting) continue;
    let near = -1, nd = PICK_RANGE;
    for (let i = 0; i < world.ents.length; i++) {
      const e = world.ents[i];
      if (e.kind !== 'item' || Math.abs(e.y - p.pos.y) > 1.5) continue;
      const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.z);
      if (d < nd) { nd = d; near = i; }
    }
    if (near < 0) continue;
    const e = world.ents[near], def = WEAPONS[e.w], slot = def.slot;
    const own = e.dropper === p.id && world.time < e.noPickUntil;
    const auto = !p.weapons[slot] && nd < AUTO_RANGE;
    if (own || !(edge || auto)) continue;
    world.ents.splice(near, 1);
    if (p.weapons[slot]) dropWeapon(world, p, slot, { x: e.x, z: e.z }); // 持ち替え: 今の武器をそこに置く
    setSlot(p, slot, e.w);
    p.weapons[slot].ammo = e.ammo; p.weapons[slot].reserve = e.reserve; // 弾は落とした時のまま
    if (world.round) emitInv(world, p);
    world.emit('pickup', { playerId: p.id, weapon: e.w });
  }
}
