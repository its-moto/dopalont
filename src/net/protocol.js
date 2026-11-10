// メッセージの種類。すべて { t: 種類, ... } の JSON で送る
//
// クライアント → ホスト
//   hello  { name, v }                 接続直後のあいさつ
//   act    { a: { type, ... } }        ロビー操作: team{team} / ready{ready}
//   in     { c: [cmd, ...] }           入力。cmd は sim に渡す入力 + seq (通し番号)
//   pong   { ts }
//
// ホスト → クライアント
//   welcome { id, lobby }              あなたの ID とロビーの状態
//   lobby   { lobby }                  ロビーの状態 (変わるたびに全体を送る)
//   start   { lobby, roster }          試合開始
//   s       { k, p: [entry...], ev }   スナップショット。k = tick、ev = イベントの列
//   ping    { ts }
//   end     {}                         試合終了、ロビーへ戻る
//   bye     { reason }                 切断の理由 (キック、満員、版が違う)
//
// スナップショットの entry (プレイヤー 1 人ぶん) は配列で送って通信量を減らす
export const E = { ID: 0, X: 1, Y: 2, Z: 3, YAW: 4, PITCH: 5, CROUCH: 6, FLAGS: 7, HP: 8, ARMOR: 9, ACK: 10, VX: 11, VY: 12, VZ: 13 };
export const F = { ALIVE: 1, GROUND: 2 };

/** クライアントに配るイベント。足音などは各自が動きから作るので送らない */
export const NET_EVENTS = new Set(['shot', 'hit', 'kill', 'respawn', 'join', 'left']);

const r3 = (v) => Math.round(v * 1000) / 1000;

export function packPlayer(p) {
  return [
    p.id, r3(p.pos.x), r3(p.pos.y), r3(p.pos.z), r3(p.yaw), r3(p.pitch), r3(p.crouch),
    (p.alive ? F.ALIVE : 0) | (p.onGround ? F.GROUND : 0),
    Math.max(0, Math.ceil(p.hp)), p.armor, p.ack, r3(p.vel.x), r3(p.vel.y), r3(p.vel.z),
  ];
}
