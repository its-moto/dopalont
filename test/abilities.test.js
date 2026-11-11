// アビリティの確認。`npm test` で実行
import assert from 'node:assert/strict';
import { World, TICK } from '../src/sim/world.js';
import { FOUNDRY } from './fixture-map.js';
import { startRound, buy } from '../src/sim/round.js';
import { AGENTS, AGENT_LIST, ABILITY_KEYS } from '../src/data/agents.js';
import { WEAPONS } from '../src/data/weapons.js';
import { RULES } from '../src/data/rules.js';

const base = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, use: false, slot: null, ab: null, yaw: 0, pitch: 0 };

// ---- データ ----
assert.equal(AGENT_LIST.length, 5);
for (const a of AGENT_LIST) {
  for (const k of ABILITY_KEYS) {
    const d = a.abilities[k];
    assert.ok(d && d.name && d.desc && d.kind, `${a.id}.${k} の定義`);
    if (d.kind === 'weapon') assert.ok(WEAPONS[d.weapon], `${a.id}.${k} の武器`);
  }
  assert.ok(a.abilities.x.ult > 0, `${a.id} のアルティメットの必要ポイント`);
}

// ---- 試合を用意する: 攻撃 2 人 (a1, a2) と防衛 1 人 (d1)。場所は中庭 ----
function setup(agents) {
  const w = new World(FOUNDRY, { seed: 11, targets: false, rounds: { winsNeeded: 13 } });
  const ps = {};
  for (const [id, team] of [['a1', 'attack'], ['a2', 'attack'], ['d1', 'defense']]) ps[id] = w.addPlayer(id, { team, agent: agents[id] || 'gale' });
  startRound(w);
  w.round.timer = 0; // 購入フェーズを飛ばす
  const events = [];
  const step = (secs, cmds = {}) => {
    const out = {};
    for (const [id, p] of w.players) out[id] = [{ ...base, yaw: p.yaw, pitch: p.pitch, ...cmds[id] }];
    for (let i = 0; i < Math.max(1, Math.round(secs / TICK)); i++) {
      w.step(TICK, out);
      events.push(...w.drainEvents());
      for (const id in out) out[id][0].ab = null; // 押した瞬間だけ
    }
  };
  const place = (p, x, z, yaw = 0, y = 0) => { p.pos.x = x; p.pos.y = y; p.pos.z = z; p.vel.x = p.vel.y = p.vel.z = 0; p.yaw = yaw; p.pitch = 0; p.histN = 0; };
  step(TICK * 2);
  place(ps.a1, 4, 12); place(ps.a2, 8, 13); place(ps.d1, 4, 0, Math.PI);
  step(0.1);
  events.length = 0;
  return { w, ...ps, step, place, events, got: (t) => events.filter((e) => e.type === t) };
}
const ents = (w, kind) => w.ents.filter((e) => e.kind === kind);

// ---- 回数・購入・ラウンド開始の補充 ----
{
  const w = new World(FOUNDRY, { seed: 1, targets: false, rounds: {} });
  const p = w.addPlayer('p', { team: 'attack', agent: 'gale' }), q = w.addPlayer('q', { team: 'defense', agent: 'haze' });
  startRound(w);
  assert.deepEqual(p.abil, { c: 0, q: 0, e: 1 }, 'シグネチャーは毎ラウンド 1 回もらえる');
  assert.equal(q.abil.e, 1, 'スカイカーテンも 1 回は無料');
  assert.equal(buy(w, p, 'ab:c'), true); assert.equal(buy(w, p, 'ab:c'), true);
  assert.equal(buy(w, p, 'ab:c'), false, '持てる数まで');
  assert.equal(p.abil.c, 2); assert.equal(p.credits, 800 - 400);
  assert.equal(buy(w, p, 'ab:x'), false, 'アルティメットは買えない');
  w.step(TICK, { p: [{ ...base, ab: 'c' }] });
  assert.equal(p.abil.c, 2, '購入フェーズ中は使えない');
}

// ---- ゲイル: 煙幕、上昇、ダッシュ (2 キルで回復)、投げナイフ ----
{
  const t = setup({ a1: 'gale' }), { w, a1, d1, step } = t;
  a1.abil.c = 1; a1.abil.q = 1;
  step(TICK, { a1: { ab: 'c' } });
  assert.equal(ents(w, 'proj').length, 1); assert.equal(a1.abil.c, 0);
  step(1.5);
  assert.equal(ents(w, 'smoke').length, 1, '投げ物が止まると煙幕になる');
  step(5);
  assert.equal(ents(w, 'smoke').length, 0, '時間で消える');

  step(TICK, { a1: { ab: 'q' } });
  let top = 0;
  for (let i = 0; i < 80; i++) { step(TICK); top = Math.max(top, a1.pos.y); }
  assert.ok(top > 3.3 && top < 4.3, `アップウィンドで約 3.8m 跳ぶ (${top.toFixed(2)})`);

  step(1);
  const z0 = a1.pos.z;
  step(TICK, { a1: { ab: 'e' } });
  step(0.4);
  assert.ok(z0 - a1.pos.z > 5.5 && z0 - a1.pos.z < 9, `ダッシュで約 7m 進む (${(z0 - a1.pos.z).toFixed(1)})`);
  assert.equal(a1.abil.e, 0);
  step(TICK, { a1: { ab: 'e' } });
  assert.equal(a1.dashT <= 0, true, '回数がなければ使えない');

  // 投げナイフ: 頭で一撃、キルで 5 本に戻る。ポイントは使うと 0 に
  a1.ult = AGENTS.gale.abilities.x.ult;
  t.place(a1, 4, 12); t.place(d1, 4, 2, Math.PI);
  step(0.2);
  step(TICK, { a1: { ab: 'x' } });
  assert.equal(a1.slot, 'ult'); assert.equal(a1.weapons.ult.ammo, 5); assert.equal(a1.ult, 0);
  step(0.5);
  step(TICK, { a1: { fire: true, pitch: Math.atan2(1.64 - 1.62, 10) } });
  assert.equal(d1.alive, false, 'ナイフの頭は一撃');
  assert.equal(a1.weapons.ult.ammo, 5, 'キルで全部戻る');
  assert.equal(a1.ult, 1, 'キルでポイントが 1 たまる');
  assert.equal(d1.ult, 1, 'やられた側にも 1 たまる');
}

// ---- エンバー: 炎の壁 (敵は焼け、自分は回復)、火炎瓶、閃光、リワインド ----
{
  const t = setup({ a1: 'ember' }), { w, a1, a2, d1, step } = t;
  a1.abil.c = 1; a1.abil.q = 2;
  step(TICK, { a1: { ab: 'c' } });
  const wall = ents(w, 'firewall')[0];
  assert.ok(wall && Math.abs(wall.x - 4) < 0.1 && wall.z2 < wall.z, '前方に炎の壁が伸びる');
  a1.hp = 50; t.place(a1, 4, 8); t.place(d1, 4, 4, Math.PI);
  step(1);
  assert.ok(d1.hp <= 78 && d1.hp >= 55, `壁の中の敵は毎秒およそ 30 削られる (${d1.hp})`);
  assert.ok(a1.hp > 58, `自分は回復する (${a1.hp.toFixed(0)})`);
  t.place(d1, 10, -6, Math.PI); // 壁から出る
  step(8);
  assert.equal(ents(w, 'firewall').length, 0);

  // 閃光: 見ている人だけ目がくらむ。背を向けていれば平気
  // 閃光は約 11m 先 (z≈1) で炸裂する。d1 はその先からこちらを向いている
  t.place(a1, 4, 12); t.place(d1, 4, -4, Math.PI); t.place(a2, 8, 13, Math.PI);
  step(0.1); t.events.length = 0;
  step(TICK, { a1: { ab: 'q' } });
  step(0.8);
  const fl = t.got('flashed').map((e) => e.victimId);
  assert.ok(fl.includes('d1'), '閃光の方を向いている敵は目がくらむ');
  assert.ok(fl.includes('a1'), '投げた本人も見ていればくらむ');
  assert.ok(!fl.includes('a2'), '背を向けていれば平気');

  // 火炎瓶: 足元に投げる
  t.place(a1, 4, 12); t.place(d1, 4, 6, Math.PI); d1.hp = 100;
  step(TICK, { a1: { ab: 'e', pitch: -0.5 } });
  step(1.2);
  assert.equal(ents(w, 'fire').length, 1);
  step(1);
  assert.ok(d1.hp <= 70, `火の中の敵は毎秒 60 削られる (${d1.hp})`);

  // リワインド: やられても使った場所に全快で戻る
  step(4);
  a1.ult = AGENTS.ember.abilities.x.ult;
  t.place(a1, 4, 12); t.place(d1, 4, 2, Math.PI); a1.hp = 40;
  d1.loadout.primary = 'ar_tap'; w.spawn(d1); t.place(d1, 4, 2, Math.PI);
  step(TICK, { a1: { ab: 'x' } });
  t.place(a1, 8, 8);
  step(0.2);
  step(TICK, { d1: { fire: true, yaw: Math.atan2(-(8 - 4), -(8 - 2)), pitch: Math.atan2(1.64 - 1.62, Math.hypot(4, 6)) } });
  assert.equal(a1.alive, true, 'リワインド中はやられない');
  assert.equal(a1.hp, 100);
  assert.ok(Math.abs(a1.pos.x - 4) < 0.01 && Math.abs(a1.pos.z - 12) < 0.01, '使った場所に戻る');
}

// ---- ヘイズ: 狙った場所に煙幕、加速、光線 ----
{
  const t = setup({ a1: 'haze' }), { w, a1, a2, d1, step } = t;
  a1.abil.c = 1; a1.abil.q = 1;
  step(TICK, { a1: { ab: 'e', pitch: -0.2 } });
  assert.equal(ents(w, 'warn').length, 1, '落下の予告が出る');
  step(1.1);
  const sm = ents(w, 'smoke')[0];
  assert.ok(sm && sm.z < 12 && sm.z > 0, `視線の先の床に煙幕 (z=${sm?.z.toFixed(1)})`);

  t.place(a2, 5, 12);
  step(TICK, { a1: { ab: 'c' } });
  step(0.1);
  assert.equal(a2.rateMul, 1.1, 'ビーコンの中の味方は連射が速くなる');
  assert.equal(d1.rateMul, 1, '敵には効かない');

  a1.ult = AGENTS.haze.abilities.x.ult;
  t.place(d1, 4, 3, Math.PI); d1.hp = 100;
  step(TICK, { a1: { ab: 'x', pitch: Math.atan2(-1.62, 9) } });
  step(1.9);
  assert.equal(d1.hp, 100, '2 秒の予告の間は無傷');
  step(1.5);
  assert.equal(d1.alive, false, '光線の中にいるとやられる');
}

// ---- シーア: 電撃、索敵、壁を貫く光線 ----
{
  const t = setup({ a1: 'seer' }), { w, a1, d1, step } = t;
  a1.abil.q = 1; a1.abil.c = 1;
  // 敵の足元の床に撃ち込むと、そこで爆発する
  step(TICK, { a1: { ab: 'q', pitch: Math.atan2(0.3 - 1.62, 12) } });
  step(1);
  assert.equal(ents(w, 'proj').length, 0);
  assert.ok(d1.hp < 100 && d1.hp >= 10, `電撃の爆発でダメージ (${d1.hp})`);
  assert.equal(a1.hp, 100, '自分と味方は巻き込まれない');

  t.events.length = 0;
  step(TICK, { a1: { ab: 'e', pitch: Math.atan2(0.3 - 1.62, 6) } });
  step(1.0);
  assert.ok(d1.revealUntil > w.time, '見通せる敵が見えるようになる');
  assert.equal(w.marks.length, 1); assert.equal(w.marks[0].team, 'attack');
  assert.ok(a1.abilCd > 30, '使うと 40 秒待ち');
  step(TICK, { a1: { ab: 'e' } });
  assert.equal(ents(w, 'proj').length, 0, '待ち時間中は使えない');

  // ピアサー: 中庭の柱 (厚さ 3m) の向こうの敵に当たる
  a1.ult = AGENTS.seer.abilities.x.ult;
  t.place(a1, -1.5, 10); t.place(d1, -1.5, -6, Math.PI); d1.hp = 100; d1.armor = 0;
  step(0.2);
  step(TICK, { a1: { ab: 'x' } });
  step(0.8);
  step(TICK, { a1: { fire: true, pitch: Math.atan2(1.0 - 1.62, 16) } });
  assert.equal(d1.hp, 20, '壁を貫いて 80 ダメージ');
  step(7);
  assert.ok(!a1.weapons.ult, '6 秒で消える');
  assert.notEqual(a1.slot, 'ult');
}

// ---- メンド: 氷の壁、減速、回復、蘇生 ----
{
  const t = setup({ a1: 'mend' }), { w, a1, a2, d1, step } = t;
  a1.abil.c = 1; a1.abil.q = 1;
  const n0 = w.boxes.length;
  step(TICK, { a1: { ab: 'c' } });
  assert.equal(ents(w, 'ice').length, 4); assert.equal(w.boxes.length, n0 + 4);
  step(1, { a1: { mz: 1 } });
  assert.ok(a1.pos.z > 7.5, `氷の壁で止まる (z=${a1.pos.z.toFixed(2)})`);
  // 撃てば壊れる
  for (let i = n0; i < n0 + 4; i++) w.boxes[i].hp = 30; // どれに当たっても 1 発で壊れるように
  a1.loadout.primary = 'ar_tap'; w.spawn(a1); t.place(a1, 4, 12);
  step(0.2);
  step(TICK, { a1: { fire: true } });
  step(TICK);
  assert.equal(w.boxes.length, n0 + 3, '体力がなくなった氷は消える');
  step(30);
  assert.equal(w.boxes.length, n0, '30 秒で全部消える');

  // 減速
  t.place(a1, 4, 12); t.place(d1, 4, 5, Math.PI);
  step(TICK, { a1: { ab: 'q', pitch: -0.45 } });
  step(1.5);
  assert.equal(ents(w, 'slow').length, 1);
  assert.equal(d1.slowMul, 0.5); assert.equal(d1.noJump, true);
  step(7);
  assert.equal(d1.slowMul, 1);

  // 回復: 味方を狙えば 60、誰もいなければ自分を 30
  t.place(a1, 4, 12); t.place(a2, 4, 8); a2.hp = 20;
  step(TICK, { a1: { ab: 'e' } });
  step(5.2);
  assert.ok(Math.abs(a2.hp - 80) < 0.5, `味方を 60 回復 (${a2.hp.toFixed(1)})`);
  assert.ok(a1.abilCd > 35);

  // 蘇生
  a2.alive = false; a2.deathPos = { x: 4, y: 0, z: 8 };
  a1.ult = AGENTS.mend.abilities.x.ult;
  step(TICK, { a1: { ab: 'x', pitch: -0.2 } });
  assert.equal(a2.alive, true); assert.equal(a2.hp, 100);
  assert.ok(Math.abs(a2.pos.z - 8) < 0.01, 'やられた場所で生き返る');
}

// ---- 設置でポイント、ラウンドが変わると場の物は消える ----
{
  const t = setup({ a1: 'mend' }), { w, a1, d1, step } = t;
  const c = w.players.get(w.round.spike.carrier);
  t.place(c, -40, -8);
  step(RULES.plantTime + 0.1, { [c.id]: { use: true } });
  assert.equal(c.ult, 1, '設置で 1 ポイント');
  a1.abil.c = 1; t.place(a1, 4, 12);
  step(TICK, { a1: { ab: 'c' } });
  assert.ok(w.ents.length > 0);
  d1.alive = false;
  step(RULES.endTime + 0.5);
  assert.equal(w.round.number, 2);
  assert.equal(w.ents.length, 0); assert.equal(w.boxes.length, w.staticBoxes);
  assert.equal(c.ult, 1, 'ポイントは次のラウンドに持ち越す');
}

console.log('abilities: すべて OK');
