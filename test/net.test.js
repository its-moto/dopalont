// ホストと参加側の同期の確認 (PeerJS は使わず、メッセージを直接受け渡す)。`npm test` で実行
import assert from 'node:assert/strict';
import { TICK } from '../src/sim/world.js';
import { FOUNDRY } from './fixture-map.js';
import { HostSession } from '../src/net/host.js';
import { ClientSession } from '../src/net/client.js';
import * as L from '../src/net/lobby.js';

const neutral = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, use: false, slot: null, yaw: 0, pitch: 0 };
const fakeInput = () => ({ state: { ...neutral }, keys: new Set(), sample() { return { ...this.state }; }, consumeEdges() {} });
const wire = (m) => JSON.parse(JSON.stringify(m)); // 実際の通信と同じく JSON を通す

// ---- ロビー ----
{
  const lobby = L.createLobby('ABCDEF');
  L.addPlayer(lobby, { id: 'h', name: 'ホスト', host: true });
  for (let i = 1; i <= 5; i++) L.addPlayer(lobby, { id: 'c' + i, name: 'ホスト' });
  const count = (t) => lobby.players.filter((p) => p.team === t).length;
  assert.equal(count('attack'), 3); assert.equal(count('defense'), 3);
  assert.equal(new Set(lobby.players.map((p) => p.name)).size, 6, '同じ名前には番号がつく');
  for (const p of lobby.players) L.setTeam(lobby, p.id, 'attack');
  assert.equal(count('attack'), 5, '1 チーム 5 人まで');
  assert.equal(L.canStart(lobby).ok, true);
  L.autoBalance(lobby);
  assert.ok(Math.abs(count('attack') - count('defense')) <= 1, '自動バランス');
  L.setTeam(lobby, 'h', 'spec'); L.setTeam(lobby, 'c1', 'spec');
  for (const p of lobby.players) if (p.team !== 'spec') L.setTeam(lobby, p.id, 'attack');
  assert.equal(L.canStart(lobby).ok, false, '片方が 0 人だと開始できない');
}

// ---- 試合: ホスト 1 人 (攻撃) + 参加 1 人 (防衛) ----
const lobby = L.createLobby('ABCDEF');
L.addPlayer(lobby, { id: 'h', name: 'ホスト', host: true });
L.addPlayer(lobby, { id: 'c1', name: 'ゲスト' });
const toClient = [], conn = { conn: { open: true }, queue: [], rtt: 0.06 };
const hostRoom = { myId: 'h', lobby, conns: new Map([['c1', conn]]), broadcast: (m) => toClient.push({ at: now + 0.03, m: wire(m) }) };
let now = 0;
const host = new HostSession(hostRoom, FOUNDRY);
const toHost = [];
const clientRoom = {
  myId: 'c1', sendInput: (c) => toHost.push({ at: now + 0.03, c: wire(c) }),
  conn: { send: (m) => host.shop('c1', m.t, m.t === 'buy' ? m.item : m.slot) },
};
const client = new ClientSession(clientRoom, FOUNDRY, { roster: wire(host.rosterList()) });
client.clock = () => now;
const hi = fakeInput(), ci = fakeInput();
const clientEvents = [];

// 片道 30ms の遅延つきで両方を進める
function run(secs) {
  for (let i = 0; i < Math.round(secs / TICK); i++) {
    now += TICK;
    while (toHost.length && toHost[0].at <= now) host.onInput(conn, toHost.shift().c);
    while (toClient.length && toClient[0].at <= now) client.onSnapshot(toClient.shift().m);
    host.update(TICK, hi);
    client.update(TICK, ci);
    for (const e of client.events) clientEvents.push(e);
    const sp = client.events.find((e) => e.type === 'respawn' && e.playerId === 'c1');
    if (sp) ci.state.yaw = sp.yaw; // 画面側 (Game) がやっている「出現時に向きを合わせる」の代わり
  }
}

run(0.5);
const hp = host.world.players.get('c1'), me = client.me;
assert.ok(me.alive, '参加側が出現する');
assert.equal(me.team, 'defense');
assert.ok(Math.abs(ci.state.yaw - Math.PI) < 1e-3, '防衛側は南を向いて出現する');
assert.ok(Math.hypot(me.pos.x - hp.pos.x, me.pos.z - hp.pos.z) < 0.01, '出現位置が一致');

// 予測: 走っている間、参加側の位置はホストより少し先行し、止まれば一致する
ci.state.mz = 1;
run(0.5); // スポーンの先は防衛通路なので、0.5 秒なら必ず走り続けている
const lead = Math.hypot(me.pos.x - hp.pos.x, me.pos.z - hp.pos.z);
assert.ok(lead > 0.1 && lead < 1.2, `入力が届くまでのぶん先行する (${lead.toFixed(2)}m)`);
assert.ok(Math.hypot(client.viewOffset.x, client.viewOffset.z) < 0.02, '予測がホストの結果と一致し、補正がほぼ 0');
ci.state.mz = 0;
run(0.5);
assert.ok(Math.hypot(me.pos.x - hp.pos.x, me.pos.z - hp.pos.z) < 0.01, '止まると位置が一致');

// 他プレイヤーの表示: ホストが参加側の画面に補間されて映る
const hostP = host.world.players.get('h');
const seen = client.remotes.find((r) => r.id === 'h');
assert.ok(seen && seen.alive, 'ホストが見える');
assert.ok(Math.hypot(seen.x - hostP.pos.x, seen.z - hostP.pos.z) < 0.05);
assert.ok(host.remotes.find((r) => r.id === 'c1'), 'ホスト側にも参加者が見える');

// 購入: 参加側の注文をホストが処理し、結果が届く
assert.equal(client.round.phase, 'buy', 'ラウンドの状態が届く');
hp.credits = 9000; hostP.credits = 9000;
client.buy('ar_tap'); host.buy('ar_tap');
run(0.3);
assert.equal(me.weapons.primary?.def.id, 'ar_tap', '買った武器が手元に反映される');
assert.equal(me.credits, 9000 - 2900);
assert.equal(client.roster.get('h').credits, 9000 - 2900, '味方や相手の所持金も届く');
assert.equal(hostP.weapons.primary.def.id, 'ar_tap');

// 購入フェーズを終わらせる
host.world.round.timer = 0;
run(0.3);
assert.equal(client.round.phase, 'live');

// アビリティ: 参加側が押す → ホストが発動 → 結果が届く。ダッシュ中の位置も予測がずれない
{
  const z0 = me.pos.z;
  ci.state.ab = 'e'; run(TICK); ci.state.ab = null;
  run(0.6);
  assert.ok(Math.abs(hp.pos.z - z0) > 3, `ホスト側でダッシュした (${Math.abs(hp.pos.z - z0).toFixed(1)}m)`);
  assert.ok(Math.hypot(me.pos.x - hp.pos.x, me.pos.z - hp.pos.z) < 0.05, 'ダッシュ後の位置が参加側と一致');
  assert.equal(me.abil.e, 0, '残り回数が届く');
  hp.abil.c = 1;
  ci.state.ab = 'c'; run(TICK); ci.state.ab = null;
  run(0.15);
  assert.equal(me.armed, 'c', '構えた状態が参加側に届く');
  ci.state.fire = true; run(TICK * 2); ci.state.fire = false; // 左クリックで投げる
  run(0.2);
  assert.equal(me.armed, null);
  assert.ok(client.ents.some((e) => e.kind === 'proj'), '飛んでいる投げ物が見える');
  run(1.5);
  assert.ok(client.ents.some((e) => e.kind === 'smoke'), '煙幕が参加側にも出る');
  assert.ok(host.ents.some((e) => e.kind === 'smoke'));
}

// 撃ち合い: 参加側がホストを撃つ。判定はホストで行われ、結果が参加側に届く
hostP.pos.x = 4; hostP.pos.z = 12; hostP.pos.y = 0;
hp.pos.x = 4; hp.pos.z = 2; hp.pos.y = 0; hp.vel.x = hp.vel.z = 0;
run(0.5); // 位置の変更が参加側に伝わるのを待つ
assert.ok(Math.abs(me.pos.z - 2) < 0.05, '大きなずれは一気に合わせる');
ci.state.yaw = Math.PI; ci.state.pitch = Math.atan2(1.2 - 1.62, 10); // 南 (ホストの方) を向いて胴を狙う
run(0.2);
clientEvents.length = 0;
ci.state.fire = true;
run(0.6);
ci.state.fire = false;
run(0.3);
const shots = clientEvents.filter((e) => e.type === 'shot' && e.playerId === 'c1').length;
assert.ok(shots >= 5, `自分の射撃はすぐ手元に表示される (${shots} 発)`);
assert.ok(clientEvents.some((e) => e.type === 'hit' && e.playerId === 'c1' && e.victimId === 'h'), '命中がホストから届く');
assert.ok(clientEvents.some((e) => e.type === 'kill' && e.playerId === 'c1' && e.victimId === 'h'), 'キルが届く');
assert.equal(client.roster.get('c1').kills, 1);
assert.equal(client.roster.get('h').deaths, 1);
assert.equal(host.roster.get('c1').kills, 1);
assert.equal(hostP.alive, false);
assert.equal(client.remotes.find((r) => r.id === 'h').alive, false, '倒した相手は消える');
assert.equal(me.weapons.primary.ammo, hp.weapons.primary.ammo, '残弾の予測がホストと一致');

// 全滅でラウンド終了 → 防衛 (参加側) の勝ち
assert.ok(clientEvents.some((e) => e.type === 'roundEnd' && e.winner === 'defense' && e.reason === 'elim'));
assert.equal(client.round.phase, 'end');
assert.equal(client.round.score.defense, 1);
assert.equal(me.credits, 9000 - 2900 + 200 + 3000 > 9000 ? 9000 : 9000 - 2900 + 200 + 3000, 'キルと勝利の報酬 (上限 9000)');

// 次のラウンド: 全員が出現し直す。生き残った人は武器を持ち越し、弾は満タン
clientEvents.length = 0;
run(7.3);
assert.equal(client.round.phase, 'buy'); assert.equal(client.round.number, 2);
assert.equal(hostP.alive, true);
assert.equal(client.remotes.find((r) => r.id === 'h').alive, true);
assert.equal(me.weapons.primary?.def.id, 'ar_tap');
assert.equal(me.weapons.primary.ammo, 25);
assert.ok(me.pos.z < -44, 'スポーンに戻る');
assert.ok(Math.abs(ci.state.yaw - Math.PI) < 1e-3, '向きもスポーンの向きに戻る');
assert.ok(!hostP.weapons.primary, 'やられた人は武器を失う');

// ホストが参加側を倒す → 参加側はやられたことを知る
hostP.credits = 9000; host.buy('ar_tap');
host.world.round.timer = 0;
run(0.3);
hostP.pos.x = 4; hostP.pos.z = 12; hostP.pos.y = 0; hp.pos.x = 4; hp.pos.z = 2; hp.pos.y = 0;
hi.state.yaw = 0; hi.state.pitch = Math.atan2(1.64 - 1.62, 10);
run(0.2);
hi.state.fire = true; run(0.1); hi.state.fire = false;
run(0.3);
assert.equal(me.alive, false, '参加側がやられたことを知る');
assert.equal(client.round.score.attack, 1);

// 途中退出
host.removePlayer('c1');
hostRoom.conns.delete('c1');
run(0.1);
assert.equal(host.world.players.has('c1'), false);

console.log('net: すべて OK');
