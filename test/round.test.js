// ラウンド・スパイク・経済・購入の確認。`npm test` で実行
import assert from 'node:assert/strict';
import { World, TICK } from '../src/sim/world.js';
import { FOUNDRY } from './fixture-map.js';
import { startRound, buy, sell } from '../src/sim/round.js';
import { RULES } from '../src/data/rules.js';
import { WEAPONS } from '../src/data/weapons.js';

const base = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, use: false, slot: null, yaw: 0, pitch: 0 };
const w = new World(FOUNDRY, { seed: 5, targets: false, rounds: { winsNeeded: 3 } });
const a1 = w.addPlayer('a1', { team: 'attack' }), a2 = w.addPlayer('a2', { team: 'attack' }), d1 = w.addPlayer('d1', { team: 'defense' });
const r = w.round;
let events = [];
const step = (secs, cmds = {}) => {
  const out = {};
  for (const [id, p] of w.players) out[id] = [{ ...base, yaw: p.yaw, ...cmds[id] }]; // 指定のない人は何も押していない
  for (let i = 0; i < Math.round(secs / TICK); i++) { w.step(TICK, out); events.push(...w.drainEvents()); }
};
const got = (type) => events.some((e) => e.type === type);
const place = (p, x, z, y = 0) => { p.pos.x = x; p.pos.y = y; p.pos.z = z; p.vel.x = p.vel.y = p.vel.z = 0; };
/** スパイクを持っている人。まだ床にあれば、攻撃側の 1 人に拾わせる */
const carrier = () => {
  if (!r.spike.carrier) {
    const p = [...w.players.values()].find((q) => q.team === 'attack' && q.alive);
    place(p, r.spike.x, r.spike.z);
    step(TICK * 2);
  }
  return w.players.get(r.spike.carrier);
};

// ---- ラウンド 1: 購入フェーズ ----
startRound(w);
assert.equal(r.phase, 'buy'); assert.equal(r.timer, RULES.buyTimeFirst);
assert.equal(a1.credits, 800);
assert.equal(a1.slot, 'sidearm'); assert.ok(!a1.weapons.primary, '最初はピストルとナイフだけ');
assert.equal(r.spike.state, 'dropped', 'スパイクは最初、床に落ちている');
assert.ok(r.spike.z > 44 && r.spike.z < 58, '攻撃スポーンの中にある');
place(d1, r.spike.x, r.spike.z); step(TICK * 2);
assert.equal(r.spike.carrier, null, '防衛側は拾えない');
w.spawn(d1);
assert.ok(['a1', 'a2'].includes(carrier().id), '攻撃側が上を通ると拾う (購入フェーズ中でも)');

assert.equal(buy(w, a1, 'ar_tap'), false, 'お金が足りない');
assert.equal(buy(w, a1, 'pistol_heavy'), true);
assert.equal(a1.credits, 0); assert.equal(a1.weapons.sidearm.def.id, 'pistol_heavy');
assert.equal(buy(w, a1, 'pistol_silenced'), true, '同じラウンドの買い直しは差額だけ');
assert.equal(a1.credits, 300);
assert.equal(sell(w, a1, 'sidearm'), true);
assert.equal(a1.credits, 800); assert.equal(a1.weapons.sidearm.def.id, 'pistol_basic');
assert.equal(buy(w, a1, 'light'), true);
assert.equal(a1.armor, 25); assert.equal(a1.credits, 400);
assert.equal(buy(w, a1, 'heavy'), false, 'ライトを売った分を足しても足りない');
assert.equal(buy(w, d1, 'knife'), false, '売っていない物は買えない');

// 購入フェーズ中はスポーンのまわりから出られない
step(5, { a1: { mz: 1 }, d1: { mz: 1 } });
assert.ok(a1.pos.z >= 36.3, `攻撃側は見えない壁で止まる (z=${a1.pos.z.toFixed(1)})`);
assert.ok(d1.pos.z <= -40.3, `防衛側も止まる (z=${d1.pos.z.toFixed(1)})`);

step(41);
assert.equal(r.phase, 'live'); assert.ok(got('phase'));
assert.equal(buy(w, a2, 'light'), false, '戦闘が始まったら買えない');

// 全滅で攻撃側の勝ち。勝ち 3000、負け 1900
d1.alive = false;
step(TICK);
assert.equal(r.phase, 'end'); assert.equal(r.winner, 'attack'); assert.equal(r.reason, 'elim');
assert.deepEqual(r.score, { attack: 1, defense: 0 });
assert.equal(a1.credits, 400 + 3000); assert.equal(d1.credits, 800 + 1900);

// ---- ラウンド 2: 設置と解除 ----
events = [];
step(RULES.endTime + TICK);
assert.equal(r.phase, 'buy'); assert.equal(r.number, 2); assert.equal(r.timer > 29, true);
assert.ok(d1.alive, 'やられた人も次のラウンドで復活');
assert.equal(a1.armor, 25, '生き残った人はアーマーを持ち越す');
assert.ok(got('roundStart'));
assert.equal(buy(w, a2, 'ar_tap'), true);
assert.equal(a2.slot, 'primary');
step(RULES.buyTime + TICK);

const c = carrier();
place(c, 0, 0); // サイトの外
step(1, { [c.id]: { use: true } });
assert.equal(r.spike.plant, 0, 'サイトの外では設置できない');
place(c, -40, -8); // A サイト
step(2, { [c.id]: { use: true, mz: 1 } });
assert.ok(r.spike.plant > 1.9 && Math.abs(c.pos.z - -8) < 0.3, `設置中は動けない (z=${c.pos.z.toFixed(2)})`);
step(1); // 手を離すとやり直し
assert.equal(r.spike.plant, 0);
events = [];
step(RULES.plantTime + 0.1, { [c.id]: { use: true } });
assert.equal(r.phase, 'planted'); assert.equal(r.spike.state, 'planted'); assert.equal(r.spike.site, 'A');
assert.ok(got('plant'));
assert.ok(Math.abs(r.timer - RULES.spikeTime) < 0.2);

// 設置後は攻撃側が全滅しても終わらない
const credA = a1.credits;
a1.alive = false; a2.alive = false;
step(0.5);
assert.equal(r.phase, 'planted');

// 解除: 半分を越えてから手を離すと、半分から再開できる
place(d1, -40, -7);
step(2, { d1: { use: true } });
step(0.5);
assert.equal(r.spike.defuse, 0, '半分に届く前に離すと最初から');
step(3.6, { d1: { use: true } });
step(0.5);
assert.equal(r.spike.defuse, RULES.defuseHalf);
events = [];
step(3.6, { d1: { use: true } });
assert.equal(r.phase, 'end'); assert.equal(r.winner, 'defense'); assert.equal(r.reason, 'defuse');
assert.ok(got('defuse'));
assert.deepEqual(r.score, { attack: 1, defense: 1 });
assert.equal(a1.credits, credA + 1900, '負けた側は 1900');

// ---- ラウンド 3: ハーフタイムで攻守交代 (3 本先取なら 2 ラウンド後) ----
step(RULES.endTime + TICK);
assert.equal(r.number, 3); assert.equal(r.half, 2);
assert.equal(a1.team, 'defense'); assert.equal(d1.team, 'attack');
assert.equal(a1.credits, 800, '後半の最初は 800 に戻る');
assert.ok(!a2.weapons.primary, '武器もリセット');
assert.equal(carrier().id, 'd1');
assert.ok(d1.pos.z > 40, '攻撃側のスポーンに出る');
step(RULES.buyTimeFirst + TICK);

// 爆発: 範囲内は全員やられ、攻撃側の勝ち
place(d1, 40, -10); // B サイト
step(RULES.plantTime + 0.1, { d1: { use: true } });
assert.equal(r.spike.site, 'B');
place(a1, 42, -8); place(a2, -50, 50);
events = [];
step(RULES.spikeTime + 0.1);
assert.ok(got('explode'));
assert.equal(a1.alive, false, '近くにいると爆発に巻き込まれる');
assert.equal(d1.alive, false);
assert.equal(a2.alive, true, '遠くにいれば助かる');
assert.equal(r.winner, 'attack'); assert.equal(r.reason, 'explode');
assert.deepEqual(r.score, { attack: 2, defense: 1 });

// ---- ラウンド 4: 時間切れは防衛の勝ち → 2-2 で延長戦 ----
step(RULES.endTime + TICK);
step(RULES.buyTime + RULES.roundTime + 0.1);
assert.equal(r.winner, 'defense'); assert.equal(r.reason, 'time');
assert.deepEqual(r.score, { attack: 2, defense: 2 });
step(RULES.endTime + TICK);
assert.equal(r.number, 5); assert.equal(r.overtime, true);
assert.equal(a1.team, 'attack', '延長戦は毎ラウンド攻守交代');
assert.equal(a1.credits, RULES.overtimeCredits);

// スパイクを持った人がやられると落とし、味方が拾える。キルで 200
assert.equal(buy(w, d1, 'ar_tap'), true);
step(RULES.buyTimeFirst + TICK);
const c5 = carrier(), mate = c5 === a1 ? a2 : a1;
place(c5, 4, 2); place(mate, -50, 50); place(d1, 4, 12);
step(0.2);
const credD = d1.credits;
events = [];
step(TICK, { d1: { fire: true, yaw: 0, pitch: Math.atan2(1.64 - 1.62, 10) } });
assert.equal(c5.alive, false);
assert.equal(d1.credits, credD + RULES.killCredits);
assert.ok(got('spikeDrop'));
assert.equal(r.spike.state, 'dropped'); assert.ok(Math.abs(r.spike.x - 4) < 0.01);
place(mate, 4, 2.5);
step(0.1);
assert.equal(r.spike.carrier, mate.id, '味方が拾う');
assert.ok(got('spikePickup'));

// 3-2 では決まらず (2 差が必要)、4-2 で試合終了
mate.alive = false;
step(TICK);
assert.deepEqual(r.score, { attack: 2, defense: 3 });
step(RULES.endTime + TICK);
assert.equal(r.phase, 'buy'); assert.equal(r.number, 6);
assert.equal(d1.team, 'attack'); assert.deepEqual(r.score, { attack: 3, defense: 2 });
step(RULES.buyTimeFirst + TICK);
a1.alive = false; a2.alive = false;
step(TICK);
events = [];
step(RULES.endTime + TICK);
assert.equal(r.phase, 'over'); assert.equal(r.matchWinner, 'attack');
assert.deepEqual(r.score, { attack: 4, defense: 2 });
assert.ok(got('matchEnd'));

// ---- 壁抜きとスコープ ----
{
  const w2 = new World(FOUNDRY, { seed: 9, targets: false });
  const s = w2.addPlayer('s', { team: 'attack', loadout: { primary: 'ar_tap', sidearm: 'pistol_basic', melee: 'knife' } });
  const v = w2.addPlayer('v', { team: 'defense' });
  const fire = (cmd) => { const ev = []; w2.step(TICK, { s: [{ ...base, fire: true, ...cmd }] }); ev.push(...w2.drainEvents()); s.prevFire = false; s.weapons[s.slot].nextFire = 0; s.sprayIndex = 0; return ev; };
  for (let i = 0; i < 40; i++) w2.step(TICK, {});
  // 中庭の低い壁 (厚さ 0.8m) の向こうにいる敵の脚を、壁越しに撃つ
  place(s, -6, -2); place(v, -6, -11.5); v.hp = 100; v.histN = 0;
  w2.step(TICK, {}); w2.drainEvents();
  let hit = fire({ pitch: Math.atan2(0.6 - 1.62, 9.5) }).find((e) => e.type === 'hit');
  assert.ok(hit && hit.through, '薄い壁を抜けて当たる');
  assert.equal(hit.damage, Math.round(34 * 0.5), 'ライフルの壁抜きは威力 50%');
  // 厚い建物 (中庭の柱 3m) は抜けない
  place(s, -1.5, 10); place(v, -1.5, -6); v.histN = 0;
  w2.step(TICK, {}); w2.drainEvents();
  hit = fire({ pitch: Math.atan2(1.0 - 1.62, 16) }).find((e) => e.type === 'hit');
  assert.ok(!hit, '厚い壁は抜けない');

  // ナイフは近くの敵にだけ当たり、弾は減らない
  place(s, 6, 6); place(v, 6, 4.2); v.hp = 100; v.histN = 0;
  w2.step(TICK, { s: [{ ...base, slot: 'melee' }] });
  for (let i = 0; i < 40; i++) w2.step(TICK, {});
  w2.drainEvents();
  hit = fire({ pitch: -0.2 }).find((e) => e.type === 'hit');
  assert.equal(hit?.damage, 50);
  place(v, 6, 0); v.histN = 0;
  w2.step(TICK, {}); w2.drainEvents();
  assert.ok(!fire({ pitch: -0.1 }).some((e) => e.type === 'hit'), 'ナイフは遠くに届かない');

  // 全武器のデータがそろっている
  for (const def of Object.values(WEAPONS)) {
    for (const k of ['name', 'slot', 'model', 'sound', 'price', 'magSize', 'fireRate', 'damage', 'spread', 'recoil', 'moveSpeedMul']) {
      assert.ok(def[k] !== undefined, `${def.id} に ${k} がない`);
    }
  }
  assert.equal(Object.keys(WEAPONS).length, 21, '18 種 + ナイフ + アルティメット用 2 種');
}

// ---- 武器とスパイクを落とす (G)、拾う (F / 上を通る) ----
{
  const w3 = new World(FOUNDRY, { seed: 21, targets: false, rounds: { winsNeeded: 13 } });
  const p1 = w3.addPlayer('p1', { team: 'attack' }), p2 = w3.addPlayer('p2', { team: 'attack' }), e1 = w3.addPlayer('e1', { team: 'defense' });
  startRound(w3);
  const ev = [];
  const go = (secs, cmds = {}) => {
    const out = {};
    for (const [id, p] of w3.players) out[id] = [{ ...base, yaw: p.yaw, ...cmds[id] }];
    for (let i = 0; i < Math.max(1, Math.round(secs / TICK)); i++) {
      w3.step(TICK, out); ev.push(...w3.drainEvents());
      for (const id in out) { out[id][0].drop = false; out[id][0].slot = null; } // 押した瞬間だけ
    }
  };
  const items = () => w3.ents.filter((e) => e.kind === 'item');
  const sp = w3.round.spike;
  p1.credits = 9000;
  assert.equal(buy(w3, p1, 'ar_tap'), true);
  w3.round.timer = 0; go(TICK * 2);
  place(p1, 4, 12); place(p2, 8, 12); place(e1, 4, -8); p1.yaw = 0; p2.yaw = 0;
  go(0.1);

  // G で持っている武器を前に落とす。落とした物は売れない
  p1.weapons.primary.ammo = 7;
  go(TICK, { p1: { drop: true } });
  assert.equal(items().length, 1); assert.equal(items()[0].w, 'ar_tap');
  assert.ok(!p1.weapons.primary && p1.slot === 'sidearm', 'サブ武器に持ち替わる');
  assert.ok(Math.abs(items()[0].z - (12 - 1.3)) < 0.01, '前方に落ちる');
  go(0.3, { p1: { mz: 1 } });
  assert.ok(!p1.weapons.primary, '落とした本人は、すぐには拾い直さない');
  // 味方が上を通ると拾う (メイン武器を持っていないので)。弾は落とした時のまま
  place(p1, 4, 14); place(p2, 4, 10.7);
  go(0.1);
  assert.equal(p2.weapons.primary?.def.id, 'ar_tap', '味方に渡せる');
  assert.equal(p2.weapons.primary.ammo, 7);
  assert.equal(items().length, 0);

  // F で持ち替え: 今の武器がその場に残る
  p1.loadout.primary = 'smg_main'; w3.spawn(p1); place(p1, 8, 12); p1.yaw = 0;
  go(TICK, { p1: { drop: true } });
  place(p1, 20, 20); place(p2, 8, 11.5);
  go(0.2);
  assert.equal(p2.weapons.primary.def.id, 'ar_tap', '持っている時は、上を通っても拾わない');
  go(TICK, { p2: { use: true } });
  assert.equal(p2.weapons.primary.def.id, 'smg_main', 'F で拾う');
  assert.equal(items().length, 1); assert.equal(items()[0].w, 'ar_tap', '持っていた武器はそこに置かれる');

  // サブ武器も落とせる。ナイフだけになる
  place(p1, 4, 12); p1.yaw = 0;
  go(TICK, { p1: { drop: true } });
  assert.equal(p1.slot, 'melee');
  go(TICK, { p1: { drop: true } });
  assert.ok(p1.weapons.melee, 'ナイフは落とせない');

  // スパイク: ナイフを持って G で前に置く。置いた本人はすぐには拾わず、味方が拾える
  place(p1, sp.x, sp.z); go(TICK * 2);
  assert.equal(sp.carrier, 'p1');
  place(p1, 4, 12); p1.yaw = 0; go(TICK * 2);
  go(TICK, { p1: { drop: true } });
  assert.equal(sp.state, 'dropped'); assert.ok(Math.abs(sp.z - (12 - 1.3)) < 0.01);
  go(0.3, { p1: { mz: 1 } });
  assert.equal(sp.carrier, null, '置いた本人はすぐには拾い直さない');
  place(p2, 4, 10.7); go(TICK * 2);
  assert.equal(sp.carrier, 'p2', '味方が拾う');
  go(1.5); place(p1, 4, 30);

  // やられると、持っていた武器をその場に落とす
  const before = items().length;
  place(p2, 4, -8); p2.hp = 1;
  place(e1, 4, 8); e1.yaw = 0; e1.pitch = 0;
  go(0.2);
  go(TICK, { e1: { fire: true, pitch: Math.atan2(1.2 - 1.62, 16) } });
  assert.equal(p2.alive, false);
  assert.equal(items().length, before + 1);
  assert.equal(items().pop().w, 'smg_main');
  assert.equal(sp.state, 'dropped', 'スパイクも落とす');
  // 次のラウンド: 落ちている物は片付けられ、サブ武器がなければピストルが支給される
  p1.alive = false;
  go(RULES.endTime + 0.3);
  assert.equal(w3.round.number, 2);
  assert.equal(items().length, 0);
  assert.equal(p1.weapons.sidearm?.def.id, 'pistol_basic');
}

console.log('round: すべて OK');
