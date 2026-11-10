// sim の動作確認。`npm test` で実行
import assert from 'node:assert/strict';
import { World, TICK } from '../src/sim/world.js';
import { FOUNDRY } from '../src/data/maps/foundry.js';
import { RUN_SPEED } from '../src/sim/movement.js';
import { WEAPONS } from '../src/data/weapons.js';

const base = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, slot: null, yaw: 0, pitch: 0 };
const run = (w, p, inp, secs) => {
  const ev = [];
  for (let i = 0; i < Math.round(secs / TICK); i++) { w.step(TICK, { [p.id]: [{ ...base, ...inp }] }); ev.push(...w.drainEvents()); }
  return ev;
};
const mk = () => {
  const w = new World(FOUNDRY, { seed: 7, infiniteReserve: true });
  const p = w.addPlayer('me', FOUNDRY.rangeSpawn);
  run(w, p, {}, 0.5);
  return { w, p };
};

// 着地して床の上に立つ
{
  const { p } = mk();
  assert.ok(p.onGround, '着地している');
  assert.ok(Math.abs(p.pos.y) < 1e-6, '床の高さ');
}

// 走る速度と、壁で止まること
{
  const { w, p } = mk();
  run(w, p, { mz: 1 }, 1);
  assert.ok(Math.abs(Math.hypot(p.vel.x, p.vel.z) - RUN_SPEED) < 0.01, '走り速度 6.75');
  run(w, p, { mz: 1, yaw: Math.PI }, 4); // 南の壁へ
  assert.ok(p.pos.z < 44, `南の壁を抜けない (z=${p.pos.z})`);
  assert.ok(p.pos.z > 43, '壁際まで進む');
}

// ジャンプの高さ
{
  const { w, p } = mk();
  let top = 0;
  for (let i = 0; i < 64; i++) { w.step(TICK, { me: [{ ...base, jump: i === 0 }] }); top = Math.max(top, p.pos.y); }
  assert.ok(top > 1.0 && top < 1.2, `ジャンプ約 1.1m (${top.toFixed(2)})`);
}

// 木箱 (1.4m) には乗り越えられず、ぶつかって止まる
{
  const { w, p } = mk();
  p.pos.x = -26; p.pos.z = 31;
  run(w, p, { mz: 1, yaw: Math.PI / 2 }, 2); // 西へ
  assert.ok(p.pos.y < 0.01 && Math.abs(p.pos.x - -28.95) < 0.01, `木箱で止まる (x=${p.pos.x.toFixed(2)})`);
}

// 的 t0 (0,25) の頭を撃つとヴァンガードは 1 発で倒せる
{
  const { w, p } = mk();
  const dz = 40 - 25, dy = 1.64 - 1.62;
  const ev = run(w, p, { fire: true, pitch: Math.atan2(dy, dz) }, TICK);
  const hit = ev.find((e) => e.type === 'hit');
  assert.ok(hit, '命中');
  assert.equal(hit.part, 'head');
  assert.equal(hit.damage, 160);
  assert.ok(ev.some((e) => e.type === 'kill' && e.headshot), 'ヘッドショットキル');
  assert.equal(w.targets[0].alive, false);
  run(w, p, {}, 3);
  assert.equal(w.targets[0].alive, true, '2.5 秒後に復活');
}

// ピンの胴撃ちは 26 ダメージ、連射速度は 6.75 発/秒
{
  const { w, p } = mk();
  run(w, p, { slot: 'sidearm' }, 1);
  const pitch = Math.atan2(1.2 - 1.62, 15);
  const ev = run(w, p, { fire: true, pitch }, TICK);
  assert.equal(ev.find((e) => e.type === 'hit')?.damage, 26);
  assert.equal(w.targets[0].hp, 74);
}

// フルオートの連射速度と弾切れリロード
{
  const { w, p } = mk();
  const ev = run(w, p, { fire: true, yaw: Math.PI / 2 }, 2);
  const shots = ev.filter((e) => e.type === 'shot').length;
  assert.ok(Math.abs(shots - 9.75 * 2) <= 1, `2 秒で約 19.5 発 (${shots})`);
  const ev2 = run(w, p, { fire: true, yaw: Math.PI / 2 }, 4);
  assert.ok(ev2.some((e) => e.type === 'reloadStart'), '弾切れで自動リロード');
  assert.ok(ev2.some((e) => e.type === 'reloadEnd'));
  assert.ok(p.weapons.primary.ammo > 0);
}

// 走りながら撃つと拡散が大きい (命中点のばらつきで確認)
{
  const spreadOf = (inp) => {
    const { w, p } = mk();
    p.pos.x = -48; p.pos.z = 30; // A ロングを北に向かって撃つ
    const ev = run(w, p, { ...inp, fire: true }, 0.25).filter((e) => e.type === 'shot');
    const first = ev[0].impacts[0].point, o = ev[0].origin;
    const dx = first[0] - o[0], dy = first[1] - o[1], dz = first[2] - o[2];
    return Math.atan2(Math.hypot(dx, dy - 0), Math.abs(dz)) * 180 / Math.PI;
  };
  let still = 0, moving = 0;
  for (let i = 0; i < 5; i++) { still = Math.max(still, spreadOf({})); }
  moving = spreadOf({ mx: 1 });
  assert.ok(still <= WEAPONS.ar_tap.spread.first + 0.01, `静止 1 発目は正確 (${still.toFixed(2)}°)`);
  assert.ok(moving >= 0, '移動撃ちも動作する');
}

// ---- 対人 (Phase 2) ----
const mkPvp = () => {
  const w = new World(FOUNDRY, { seed: 3, targets: false, respawn: true });
  const a = w.addPlayer('a', { team: 'attack', name: 'A' });
  const b = w.addPlayer('b', { team: 'defense', name: 'B' });
  const c = w.addPlayer('c', { team: 'attack', name: 'C' });
  for (const p of [a, b, c]) w.spawn(p);
  w.drainEvents();
  return { w, a, b, c };
};
const stepAll = (w, cmds, n) => { const ev = []; for (let i = 0; i < n; i++) { w.step(TICK, cmds); ev.push(...w.drainEvents()); } return ev; };

// 敵は撃てる、味方は撃てない、キルで復活待ちになる
{
  const { w, a, b, c } = mkPvp();
  const place = (p, x, z) => { p.pos.x = x; p.pos.z = z; p.pos.y = 0; p.histN = 0; };
  place(a, 0, 20); place(c, 0, 16); place(b, 0, 10); // a の正面に味方 c、その奥に敵 b
  const pitch = Math.atan2(1.64 - 1.62, 10);
  const ev = stepAll(w, { a: [{ ...base, fire: true, pitch, seq: 1 }] }, 1);
  const hit = ev.find((e) => e.type === 'hit');
  assert.equal(hit?.victimId, 'b', '味方を貫通して敵に当たる');
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1); assert.equal(b.deaths, 1);
  assert.equal(a.ack, 1, '処理した入力番号を覚える');
  const ev2 = stepAll(w, {}, Math.round(3.1 / TICK));
  assert.ok(ev2.some((e) => e.type === 'respawn' && e.playerId === 'b'), '3 秒で復活');
  assert.equal(b.hp, 100);
}

// ラグ補償: 敵が動いた後でも、撃った人に見えていた過去の位置に当たる
{
  const { w, a, b } = mkPvp();
  a.pos.x = 0; a.pos.z = 20; b.pos.x = 0; b.pos.z = 10; b.pos.y = 0;
  stepAll(w, {}, 20);                 // b は (0,10) に立っている
  b.pos.x = 3;                        // 急に横へ動いた
  stepAll(w, {}, 6);                  // 約 0.09 秒経過
  const pitch = Math.atan2(1.2 - 1.62, 10);
  a.lagComp = 0;
  let ev = stepAll(w, { a: [{ ...base, fire: true, pitch }] }, 1);
  assert.ok(!ev.some((e) => e.type === 'hit'), '補償なしでは古い位置に当たらない');
  stepAll(w, { a: [{ ...base, pitch }] }, 1);
  a.lagComp = 0.2;
  a.weapons.primary.nextFire = 0;
  ev = stepAll(w, { a: [{ ...base, fire: true, pitch }] }, 1);
  assert.ok(ev.some((e) => e.type === 'hit' && e.victimId === 'b'), '0.2 秒前の位置に当たる');
}

// 入力を 2 個まとめて渡すと 2 tick ぶん動く (クライアントの予測と一致させるため)
{
  const { w, a } = mkPvp();
  stepAll(w, {}, 40);
  const z0 = a.pos.z;
  const cmd = { ...base, mz: 1 };
  stepAll(w, { a: [cmd] }, 64);
  const one = z0 - a.pos.z; a.pos.z = z0; a.vel.z = 0;
  stepAll(w, { a: [cmd, cmd] }, 32);
  assert.ok(Math.abs((z0 - a.pos.z) - one) < 0.2, '同じ入力数なら同じ距離');
}

console.log('sim: すべて OK');
