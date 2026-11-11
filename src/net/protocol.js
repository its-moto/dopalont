// メッセージの種類。すべて { t: 種類, ... } の JSON で送る
//
// クライアント → ホスト
//   hello  { name, v }                 接続直後のあいさつ
//   act    { a: { type, ... } }        ロビー操作: team{team} / ready{ready}
//   buy    { item } / sell { slot }    購入フェーズ中の買い物
//   in     { c: [cmd, ...] }           入力。cmd は sim に渡す入力 + seq (通し番号)。ab = アビリティのキー、drop = G キー
//   pong   { ts }
//
// ホスト → クライアント
//   welcome { id, lobby }              あなたの ID とロビーの状態
//   lobby   { lobby }                  ロビーの状態 (変わるたびに全体を送る)
//   start   { lobby, roster }          試合開始
//   s       { k, p: [entry...], r, e, ev } スナップショット。k = tick、r = ラウンドの状態、e = 場に出ている物、ev = イベントの列
//   ping    { ts }
//   end     {}                         試合終了、ロビーへ戻る
//   bye     { reason }                 切断の理由 (キック、満員、版が違う)
//
// スナップショットの entry (プレイヤー 1 人ぶん) は配列で送って通信量を減らす
export const E = { ID: 0, X: 1, Y: 2, Z: 3, YAW: 4, PITCH: 5, CROUCH: 6, FLAGS: 7, HP: 8, ARMOR: 9, ACK: 10, VX: 11, VY: 12, VZ: 13, DASH: 14, SLOW: 15 };
export const F = { ALIVE: 1, GROUND: 2, NOJUMP: 4 };
// DASH (ダッシュの残り時間) と SLOW (移動速度の倍率) は、参加側が自分の移動を正しく予測するために送る

/** クライアントに配るイベント。足音などは各自が動きから作るので送らない */
export const NET_EVENTS = new Set([
  'shot', 'hit', 'kill', 'respawn', 'join', 'left',
  'inv', 'roundStart', 'roundEnd', 'matchEnd', 'phase',
  'plantStart', 'plant', 'defuseStart', 'defuse', 'explode', 'spikeDrop', 'spikePickup',
  'abil', 'ability', 'effect', 'flashed', 'ultReady', 'drop', 'pickup',
]);

const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;

/** アビリティで場に出ている物 (world.ents と world.marks) を配列に詰める */
export function packEnts(world) {
  const out = [];
  for (const list of [world.ents, world.marks]) {
    for (const e of list) out.push([e.id, e.kind, r3(e.x), r3(e.y), r3(e.z), r3(e.r), r3(e.x2), r3(e.z2), e.team, e.owner, e.w || null]);
  }
  return out;
}

export const unpackEnt = (a) => ({ id: a[0], kind: a[1], x: a[2], y: a[3], z: a[4], r: a[5], x2: a[6], z2: a[7], team: a[8], owner: a[9], w: a[10] }); // w: 落ちている武器の ID

/** ラウンドの状態 (src/sim/round.js の world.round) を配列に詰める */
export function packRound(r) {
  const s = r.spike;
  return [r.phase, r1(r.timer), r.number, r.score.attack, r.score.defense, r.winner, r.reason, r.matchWinner, r.winsNeeded, r.overtime ? 1 : 0,
    s.state, r3(s.x), r3(s.y), r3(s.z), s.carrier, r1(s.plant), r1(s.defuse), s.user, s.site];
}

export function emptyRound() {
  return {
    phase: 'buy', timer: 0, number: 1, score: { attack: 0, defense: 0 }, winner: null, reason: '', matchWinner: null, winsNeeded: 13, overtime: false,
    spike: { state: 'none', x: 0, y: 0, z: 0, carrier: null, plant: 0, defuse: 0, user: null, site: null },
  };
}

export function unpackRound(a, r) {
  const s = r.spike;
  r.phase = a[0]; r.timer = a[1]; r.number = a[2]; r.score.attack = a[3]; r.score.defense = a[4];
  r.winner = a[5]; r.reason = a[6]; r.matchWinner = a[7]; r.winsNeeded = a[8]; r.overtime = !!a[9];
  s.state = a[10]; s.x = a[11]; s.y = a[12]; s.z = a[13]; s.carrier = a[14]; s.plant = a[15]; s.defuse = a[16]; s.user = a[17]; s.site = a[18];
  return r;
}

export function packPlayer(p) {
  return [
    p.id, r3(p.pos.x), r3(p.pos.y), r3(p.pos.z), r3(p.yaw), r3(p.pitch), r3(p.crouch),
    (p.alive ? F.ALIVE : 0) | (p.onGround ? F.GROUND : 0) | (p.noJump ? F.NOJUMP : 0),
    Math.max(0, Math.ceil(p.hp)), p.armor, p.ack, r3(p.vel.x), r3(p.vel.y), r3(p.vel.z),
    Math.max(0, r3(p.dashT)), r3(p.slowMul),
  ];
}
