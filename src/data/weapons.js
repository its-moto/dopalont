// 武器データ。数値はここだけに置く (DESIGN.md §5)
// spread: 円錐の半角 (度)。recoil.pattern[i]: i 発撃った後の照準のズレ [yaw, pitch] (度、pitch は上が +)

/** ライフルの反動: 最初は縦に跳ね、その後は左右に振れる */
function sprayPattern({ shots, climb, maxPitch, swayStart, swayAmp, swayPeriod }) {
  const out = [[0, 0]];
  let pitch = 0;
  for (let i = 1; i <= shots; i++) {
    pitch = Math.min(maxPitch, pitch + climb * (i < 8 ? 1 : 0.15));
    let yaw = 0;
    if (i > swayStart) {
      const ph = (i - swayStart) / swayPeriod;
      // 三角波に近い左右の振れ。周期ごとに少し振幅を変えて単調さを消す
      yaw = Math.sin(ph * Math.PI * 2) * swayAmp * (0.75 + 0.25 * Math.cos(ph * 1.7));
    }
    out.push([yaw, pitch]);
  }
  return out;
}

function tapPattern(shots, step, max) {
  const out = [[0, 0]];
  for (let i = 1; i <= shots; i++) out.push([(i % 2 ? 0.15 : -0.15) * Math.min(i, 3), Math.min(max, i * step)]);
  return out;
}

export const WEAPONS = {
  pistol_basic: {
    id: 'pistol_basic',
    name: 'ピン',
    slot: 'sidearm',
    model: 'pistol',
    sound: 'pistol',
    price: 0,
    magSize: 12,
    reserveAmmo: 36,
    fireRate: 6.75,
    fireMode: 'semi',
    pellets: 1,
    damage: [
      { maxRange: 30, head: 78, body: 26, leg: 22 },
      { maxRange: Infinity, head: 66, body: 22, leg: 18 },
    ],
    spread: { first: 0.35, stand: 0.4, perShot: 0.22, max: 1.5, walk: 0.9, run: 1.7, air: 4.0, crouchMul: 0.85 },
    recoil: { pattern: tapPattern(12, 0.8, 3.2), recoverDelay: 0.16, recoverRate: 11, resetTime: 0.32 },
    reloadTime: 1.75,
    equipTime: 0.75,
    ads: null,
    alt: { type: 'burst', count: 3, interval: 0.055, spread: 2.6, cooldown: 0.5 },
    moveSpeedMul: 1,
    penetration: 'low',
    kick: 1.0,
  },

  ar_tap: {
    id: 'ar_tap',
    name: 'ヴァンガード',
    slot: 'primary',
    model: 'rifle',
    sound: 'rifle',
    price: 2900,
    magSize: 25,
    reserveAmmo: 50,
    fireRate: 9.75,
    fireMode: 'auto',
    pellets: 1,
    damage: [{ maxRange: Infinity, head: 160, body: 40, leg: 34 }],
    spread: { first: 0.25, stand: 0.3, perShot: 0.1, max: 1.3, walk: 2.2, run: 5.0, air: 8.0, crouchMul: 0.8 },
    recoil: {
      pattern: sprayPattern({ shots: 25, climb: 0.78, maxPitch: 6.6, swayStart: 5, swayAmp: 1.7, swayPeriod: 9 }),
      recoverDelay: 0.14,
      recoverRate: 9,
      resetTime: 0.38,
    },
    reloadTime: 2.5,
    equipTime: 1.0,
    ads: { zoom: 1.25, spreadMul: 0.8, fireRateMul: 0.9, moveMul: 0.76 },
    alt: null,
    moveSpeedMul: 1,
    penetration: 'mid',
    kick: 1.4,
  },
};
