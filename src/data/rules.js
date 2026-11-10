// ルールの数値 (DESIGN.md §4)。時間は秒、距離は m

export const RULES = {
  winsNeeded: 13,       // ロビーで 13 / 7 / 5 から選べる
  buyTime: 30,
  buyTimeFirst: 45,     // 前半・後半の第 1 ラウンド
  roundTime: 100,
  spikeTime: 45,        // 設置から爆発まで
  endTime: 7,           // ラウンド終了の演出
  plantTime: 4,
  defuseTime: 7,
  defuseHalf: 3.5,      // ここまで進めば、手を離しても半分から再開できる
  defuseRange: 1.8,
  pickupRange: 1.3,
  blastRadius: 22,

  startCredits: 800,
  winCredits: 3000,
  lossCredits: [1900, 2400, 2900], // 連敗するほど増える
  killCredits: 200,
  plantCredits: 300,
  maxCredits: 9000,
  overtimeCredits: 5000,

  armorAbsorb: 0.66,
  armor: {
    light: { id: 'light', name: 'ライトアーマー', price: 400, value: 25 },
    heavy: { id: 'heavy', name: 'ヘビーアーマー', price: 1000, value: 50 },
  },
};

// 壁抜き: 弾が抜けられる厚み (m) と、抜けた後のダメージ倍率
export const PENETRATION = {
  low: { thick: 0.6, mul: 0.35 },
  mid: { thick: 1.3, mul: 0.5 },
  high: { thick: 2.6, mul: 0.7 },
};

export const REASON_TEXT = {
  elim: '全滅',
  time: '時間切れ',
  explode: 'スパイク爆発',
  defuse: 'スパイク解除',
};
