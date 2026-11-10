// 通信まわりの設定 (DESIGN.md §2, §3)
export const NET = {
  version: 2,                 // 互換性のない変更をしたら上げる。違う版同士は接続を断る
  idPrefix: 'valolike-',      // PeerJS の ID = これ + 参加コード
  codeChars: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // 紛らわしい 0/O/1/I/L を除く
  codeLen: 6,
  // 繋がらない環境が出たら、ここに TURN サーバーを足す
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
  snapshotEvery: 2,           // 何 tick ごとにスナップショットを送るか (64 / 2 = 32 回/秒)
  maxCmdsPerTick: 4,          // 1 tick で処理するクライアント入力の上限 (加速チート対策)
  maxQueue: 16,
  interpDelay: 0.1,           // 他プレイヤーをこの秒数だけ遅らせて補間表示する
  maxLagComp: 0.4,
  connectTimeout: 15000,
};

export const MAX_TEAM = 5;
export const TEAM_LABEL = { attack: '攻撃', defense: '防衛', spec: '観戦' };
