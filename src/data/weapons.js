// 武器データ。数値はここだけに置く (DESIGN.md §5)。性能は本家寄せ、名前はオリジナル
//
// spread: 円錐の半角 (度)。first = 静止 1 発目、stand + perShot × 連射数 (max まで)、walk / run / air = 移動中
//         hip = スコープ武器を覗かずに撃った時
// recoil.pattern[i]: i 発撃った後の照準のズレ [yaw, pitch] (度、pitch は上が +)
// moveSpeedMul: ナイフ (6.75 m/s) を 1 とした移動速度

/** 連射武器の反動: 最初は縦に跳ね、その後は左右に振れる */
function spray({ shots, climb, maxPitch, swayStart, swayAmp, swayPeriod }) {
  const out = [[0, 0]];
  let pitch = 0;
  for (let i = 1; i <= shots; i++) {
    pitch = Math.min(maxPitch, pitch + climb * (i < 8 ? 1 : 0.15));
    let yaw = 0;
    if (i > swayStart) {
      const ph = (i - swayStart) / swayPeriod;
      yaw = Math.sin(ph * Math.PI * 2) * swayAmp * (0.75 + 0.25 * Math.cos(ph * 1.7));
    }
    out.push([yaw, pitch]);
  }
  return out;
}

/** 単発武器の反動: 撃つたびに少しずつ上がる */
function tap(shots, step, max) {
  const out = [[0, 0]];
  for (let i = 1; i <= shots; i++) out.push([(i % 2 ? 0.15 : -0.15) * Math.min(i, 3), Math.min(max, i * step)]);
  return out;
}

const flat = (head, body, leg) => [{ maxRange: Infinity, head, body, leg }];
const bands = (...b) => b.map(([maxRange, head, body, leg]) => ({ maxRange, head, body, leg }));

function weapon(o) {
  return { pellets: 1, alt: null, ads: null, penetration: 'mid', kick: 1, equipTime: 0.75, ...o };
}

const LIST = [
  // ---- 近接 ----
  weapon({
    id: 'knife', name: 'ナイフ', slot: 'melee', category: '近接', model: 'knife', sound: 'knife', price: 0,
    melee: true, range: 2.3, magSize: Infinity, reserveAmmo: 0, fireRate: 2.2, fireMode: 'auto',
    damage: flat(50, 50, 50),
    spread: { first: 0, stand: 0, perShot: 0, max: 0, walk: 0, run: 0, air: 0, crouchMul: 1 },
    recoil: { pattern: [[0, 0]], recoverDelay: 0.1, recoverRate: 10, resetTime: 0.2 },
    reloadTime: 0, equipTime: 0.5, moveSpeedMul: 1, kick: 0,
  }),

  // ---- サイドアーム ----
  weapon({
    id: 'pistol_basic', name: 'ピン', slot: 'sidearm', category: 'サイドアーム', model: 'pistol', sound: 'pistol', price: 0,
    magSize: 12, reserveAmmo: 36, fireRate: 6.75, fireMode: 'semi',
    damage: bands([30, 78, 26, 22], [Infinity, 66, 22, 18]),
    spread: { first: 0.35, stand: 0.4, perShot: 0.22, max: 1.5, walk: 0.9, run: 1.7, air: 4.0, crouchMul: 0.85 },
    recoil: { pattern: tap(12, 0.8, 3.2), recoverDelay: 0.16, recoverRate: 11, resetTime: 0.32 },
    reloadTime: 1.75, moveSpeedMul: 0.85, penetration: 'low',
    alt: { type: 'burst', count: 3, interval: 0.055, spread: 2.6, cooldown: 0.5 },
  }),
  weapon({
    id: 'pistol_shotgun', name: 'スプリンター', slot: 'sidearm', category: 'サイドアーム', model: 'pistol', sound: 'shotgun', price: 150,
    magSize: 2, reserveAmmo: 10, fireRate: 3.3, fireMode: 'semi', pellets: 15,
    damage: bands([7, 36, 12, 10], [Infinity, 24, 8, 6]),
    spread: { first: 3.4, stand: 3.4, perShot: 0, max: 3.4, walk: 3.6, run: 4.0, air: 5.5, crouchMul: 0.9 },
    recoil: { pattern: tap(2, 3.0, 5), recoverDelay: 0.2, recoverRate: 8, resetTime: 0.4 },
    reloadTime: 1.75, moveSpeedMul: 0.85, penetration: 'low', kick: 2,
  }),
  weapon({
    id: 'pistol_auto', name: 'ホーネット', slot: 'sidearm', category: 'サイドアーム', model: 'pistol', sound: 'smg', price: 450,
    magSize: 13, reserveAmmo: 39, fireRate: 10, fireMode: 'auto',
    damage: bands([20, 78, 26, 22], [Infinity, 63, 21, 17]),
    spread: { first: 0.45, stand: 0.5, perShot: 0.2, max: 2.2, walk: 1.0, run: 1.8, air: 4.5, crouchMul: 0.85 },
    recoil: { pattern: spray({ shots: 13, climb: 0.7, maxPitch: 5, swayStart: 4, swayAmp: 1.4, swayPeriod: 6 }), recoverDelay: 0.14, recoverRate: 10, resetTime: 0.34 },
    reloadTime: 1.5, moveSpeedMul: 0.85, penetration: 'low',
  }),
  weapon({
    id: 'pistol_silenced', name: 'ウィスパー', slot: 'sidearm', category: 'サイドアーム', model: 'pistol', sound: 'silenced', price: 500,
    magSize: 15, reserveAmmo: 45, fireRate: 6.75, fireMode: 'semi',
    damage: bands([30, 105, 30, 25], [Infinity, 87, 25, 21]),
    spread: { first: 0.3, stand: 0.35, perShot: 0.2, max: 1.4, walk: 0.9, run: 1.7, air: 4.0, crouchMul: 0.85 },
    recoil: { pattern: tap(15, 0.75, 3), recoverDelay: 0.16, recoverRate: 11, resetTime: 0.32 },
    reloadTime: 1.5, moveSpeedMul: 0.85,
  }),
  weapon({
    id: 'pistol_heavy', name: 'マグナス', slot: 'sidearm', category: 'サイドアーム', model: 'pistol', sound: 'heavyPistol', price: 800,
    magSize: 6, reserveAmmo: 24, fireRate: 4, fireMode: 'semi',
    damage: bands([30, 159, 55, 46], [Infinity, 145, 50, 42]),
    spread: { first: 0.25, stand: 0.5, perShot: 0.6, max: 2.5, walk: 1.5, run: 3.0, air: 6.0, crouchMul: 0.85 },
    recoil: { pattern: tap(6, 2.2, 6), recoverDelay: 0.2, recoverRate: 7, resetTime: 0.45 },
    reloadTime: 2.25, moveSpeedMul: 0.85, penetration: 'high', kick: 2.2,
  }),

  // ---- SMG ----
  weapon({
    id: 'smg_light', name: 'ニードル', slot: 'primary', category: 'SMG', model: 'rifle', sound: 'smg', price: 1100,
    magSize: 20, reserveAmmo: 60, fireRate: 16, fireMode: 'auto',
    damage: bands([15, 67, 27, 23], [Infinity, 62, 25, 21]),
    spread: { first: 0.65, stand: 0.7, perShot: 0.14, max: 2.4, walk: 1.1, run: 2.0, air: 5.0, crouchMul: 0.85 },
    recoil: { pattern: spray({ shots: 20, climb: 0.62, maxPitch: 5.5, swayStart: 4, swayAmp: 2.0, swayPeriod: 7 }), recoverDelay: 0.12, recoverRate: 10, resetTime: 0.34 },
    reloadTime: 2.25, moveSpeedMul: 0.85, penetration: 'low', kick: 0.8,
  }),
  weapon({
    id: 'smg_main', name: 'ウィスプ', slot: 'primary', category: 'SMG', model: 'rifle', sound: 'silenced', price: 1600,
    magSize: 30, reserveAmmo: 90, fireRate: 13.33, fireMode: 'auto',
    damage: bands([20, 78, 26, 22], [Infinity, 66, 22, 18]),
    spread: { first: 0.4, stand: 0.45, perShot: 0.1, max: 1.7, walk: 0.9, run: 1.7, air: 4.5, crouchMul: 0.85 },
    recoil: { pattern: spray({ shots: 30, climb: 0.48, maxPitch: 4.6, swayStart: 5, swayAmp: 1.3, swayPeriod: 9 }), recoverDelay: 0.13, recoverRate: 10, resetTime: 0.34 },
    reloadTime: 2.25, moveSpeedMul: 0.85, kick: 0.8,
    ads: { zoom: 1.15, spreadMul: 0.85, fireRateMul: 0.9, moveMul: 0.76 },
  }),

  // ---- ショットガン ----
  weapon({
    id: 'sg_pump', name: 'ブロウ', slot: 'primary', category: 'ショットガン', model: 'rifle', sound: 'shotgun', price: 850,
    magSize: 5, reserveAmmo: 10, fireRate: 1.1, fireMode: 'semi', pellets: 15,
    damage: bands([8, 40, 20, 17], [12, 26, 13, 11], [Infinity, 18, 9, 8]),
    spread: { first: 2.6, stand: 2.6, perShot: 0, max: 2.6, walk: 2.8, run: 3.2, air: 5.0, crouchMul: 0.9 },
    recoil: { pattern: tap(5, 3.5, 5), recoverDelay: 0.3, recoverRate: 7, resetTime: 0.6 },
    reloadTime: 2.5, moveSpeedMul: 0.8, penetration: 'low', kick: 3,
  }),
  weapon({
    id: 'sg_auto', name: 'ヴァーディクト', slot: 'primary', category: 'ショットガン', model: 'rifle', sound: 'shotgun', price: 1850,
    magSize: 7, reserveAmmo: 21, fireRate: 3.5, fireMode: 'auto', pellets: 12,
    damage: bands([10, 34, 17, 14], [15, 26, 13, 11], [Infinity, 20, 10, 9]),
    spread: { first: 2.3, stand: 2.3, perShot: 0.12, max: 3.0, walk: 2.5, run: 2.9, air: 5.0, crouchMul: 0.9 },
    recoil: { pattern: tap(7, 1.6, 6), recoverDelay: 0.2, recoverRate: 8, resetTime: 0.45 },
    reloadTime: 2.2, moveSpeedMul: 0.8, penetration: 'low', kick: 2.4,
  }),

  // ---- ライフル ----
  weapon({
    id: 'ar_burst', name: 'ブルワーク', slot: 'primary', category: 'ライフル', model: 'rifle', sound: 'rifle', price: 2050,
    magSize: 24, reserveAmmo: 72, fireRate: 9.15, fireMode: 'auto',
    damage: flat(116, 35, 29),
    spread: { first: 0.3, stand: 0.35, perShot: 0.11, max: 1.4, walk: 2.0, run: 4.6, air: 8.0, crouchMul: 0.8 },
    recoil: { pattern: spray({ shots: 24, climb: 0.7, maxPitch: 6, swayStart: 5, swayAmp: 1.6, swayPeriod: 8 }), recoverDelay: 0.14, recoverRate: 9, resetTime: 0.38 },
    reloadTime: 2.5, equipTime: 1.0, moveSpeedMul: 0.8, kick: 1.2,
    ads: { zoom: 1.25, spreadMul: 0.7, fireRateMul: 0.9, moveMul: 0.76 },
  }),
  weapon({
    id: 'ar_semi', name: 'センチネル', slot: 'primary', category: 'ライフル', model: 'rifle', sound: 'heavyPistol', price: 2250,
    magSize: 12, reserveAmmo: 36, fireRate: 5.25, fireMode: 'semi',
    damage: flat(195, 65, 48),
    spread: { first: 0.1, stand: 0.3, perShot: 0.35, max: 1.6, walk: 2.0, run: 4.5, air: 8.0, crouchMul: 0.8 },
    recoil: { pattern: tap(12, 1.6, 6), recoverDelay: 0.2, recoverRate: 7, resetTime: 0.45 },
    reloadTime: 2.5, equipTime: 1.0, moveSpeedMul: 0.8, penetration: 'high', kick: 1.8,
    ads: { zoom: 1.5, spreadMul: 0.6, fireRateMul: 0.9, moveMul: 0.76 },
  }),
  weapon({
    id: 'ar_spray', name: 'ヴェール', slot: 'primary', category: 'ライフル', model: 'rifle', sound: 'silenced', price: 2900,
    magSize: 30, reserveAmmo: 60, fireRate: 11, fireMode: 'auto', noTracer: true,
    damage: bands([15, 156, 39, 33], [30, 140, 35, 30], [Infinity, 124, 31, 26]),
    spread: { first: 0.2, stand: 0.25, perShot: 0.08, max: 1.1, walk: 2.0, run: 4.6, air: 8.0, crouchMul: 0.8 },
    recoil: { pattern: spray({ shots: 30, climb: 0.6, maxPitch: 5.4, swayStart: 6, swayAmp: 1.3, swayPeriod: 10 }), recoverDelay: 0.14, recoverRate: 9, resetTime: 0.38 },
    reloadTime: 2.5, equipTime: 1.0, moveSpeedMul: 0.8, kick: 1.1,
    ads: { zoom: 1.25, spreadMul: 0.8, fireRateMul: 0.9, moveMul: 0.76 },
  }),
  weapon({
    id: 'ar_tap', name: 'ヴァンガード', slot: 'primary', category: 'ライフル', model: 'rifle', sound: 'rifle', price: 2900,
    magSize: 25, reserveAmmo: 50, fireRate: 9.75, fireMode: 'auto',
    damage: flat(160, 40, 34),
    spread: { first: 0.25, stand: 0.3, perShot: 0.1, max: 1.3, walk: 2.2, run: 5.0, air: 8.0, crouchMul: 0.8 },
    recoil: { pattern: spray({ shots: 25, climb: 0.78, maxPitch: 6.6, swayStart: 5, swayAmp: 1.7, swayPeriod: 9 }), recoverDelay: 0.14, recoverRate: 9, resetTime: 0.38 },
    reloadTime: 2.5, equipTime: 1.0, moveSpeedMul: 0.8, kick: 1.4,
    ads: { zoom: 1.25, spreadMul: 0.8, fireRateMul: 0.9, moveMul: 0.76 },
  }),

  // ---- スナイパー (覗かないと当たらない) ----
  weapon({
    id: 'sr_light', name: 'スパロウ', slot: 'primary', category: 'スナイパー', model: 'rifle', sound: 'sniper', price: 950,
    magSize: 5, reserveAmmo: 15, fireRate: 1.5, fireMode: 'semi',
    damage: flat(202, 101, 85),
    spread: { first: 0, stand: 0, perShot: 0, max: 0, walk: 2.5, run: 5.0, air: 8.0, crouchMul: 1, hip: 1.6 },
    recoil: { pattern: tap(5, 3, 3), recoverDelay: 0.3, recoverRate: 6, resetTime: 0.6 },
    reloadTime: 2.5, equipTime: 1.25, moveSpeedMul: 0.8, kick: 2.6,
    ads: { zoom: 2.5, spreadMul: 1, fireRateMul: 1, moveMul: 0.9, scope: true },
  }),
  weapon({
    id: 'sr_double', name: 'ツインフォーク', slot: 'primary', category: 'スナイパー', model: 'rifle', sound: 'sniper', price: 2400,
    magSize: 2, reserveAmmo: 10, fireRate: 2.75, fireMode: 'semi',
    damage: flat(238, 140, 119),
    spread: { first: 0, stand: 0, perShot: 0, max: 0, walk: 3.0, run: 5.5, air: 8.0, crouchMul: 1, hip: 2.4 },
    recoil: { pattern: tap(2, 3.5, 5), recoverDelay: 0.3, recoverRate: 6, resetTime: 0.6 },
    reloadTime: 2.4, equipTime: 1.25, moveSpeedMul: 0.8, penetration: 'high', kick: 3,
    ads: { zoom: 2.5, spreadMul: 1, fireRateMul: 1, moveMul: 0.76, scope: true },
  }),
  weapon({
    id: 'sr_heavy', name: 'ハルバード', slot: 'primary', category: 'スナイパー', model: 'rifle', sound: 'sniper', price: 4700,
    magSize: 5, reserveAmmo: 10, fireRate: 0.6, fireMode: 'semi',
    damage: flat(255, 150, 127),
    spread: { first: 0, stand: 0, perShot: 0, max: 0, walk: 4.0, run: 7.0, air: 10.0, crouchMul: 1, hip: 5 },
    recoil: { pattern: tap(5, 4, 4), recoverDelay: 0.4, recoverRate: 5, resetTime: 0.8 },
    reloadTime: 3.7, equipTime: 1.5, moveSpeedMul: 0.76, penetration: 'high', kick: 4,
    ads: { zoom: 2.5, spreadMul: 1, fireRateMul: 1, moveMul: 0.5, scope: true },
  }),

  // ---- ヘビー (撃ち続けるほど連射が速くなる) ----
  weapon({
    id: 'mg_light', name: 'ラムダ', slot: 'primary', category: 'ヘビー', model: 'rifle', sound: 'mg', price: 1600,
    magSize: 50, reserveAmmo: 100, fireRate: 10, rampTo: 13, rampShots: 8, fireMode: 'auto',
    damage: flat(72, 30, 25),
    spread: { first: 0.8, stand: 0.8, perShot: 0.05, max: 1.6, walk: 2.4, run: 5.0, air: 8.0, crouchMul: 0.6 },
    recoil: { pattern: spray({ shots: 50, climb: 0.5, maxPitch: 4.5, swayStart: 6, swayAmp: 1.8, swayPeriod: 12 }), recoverDelay: 0.14, recoverRate: 8, resetTime: 0.4 },
    reloadTime: 3.25, equipTime: 1.25, moveSpeedMul: 0.76, penetration: 'high', kick: 1.2,
    ads: { zoom: 1.15, spreadMul: 0.8, fireRateMul: 1, moveMul: 0.76 },
  }),
  weapon({
    id: 'mg_heavy', name: 'コロッサス', slot: 'primary', category: 'ヘビー', model: 'rifle', sound: 'mg', price: 3200,
    magSize: 100, reserveAmmo: 200, fireRate: 12, rampTo: 15.6, rampShots: 10, fireMode: 'auto',
    damage: flat(95, 38, 32),
    spread: { first: 0.8, stand: 0.8, perShot: 0.04, max: 1.5, walk: 2.6, run: 5.5, air: 8.0, crouchMul: 0.6 },
    recoil: { pattern: spray({ shots: 100, climb: 0.5, maxPitch: 4.8, swayStart: 6, swayAmp: 2.0, swayPeriod: 14 }), recoverDelay: 0.14, recoverRate: 8, resetTime: 0.4 },
    reloadTime: 5, equipTime: 1.25, moveSpeedMul: 0.76, penetration: 'high', kick: 1.4,
    ads: { zoom: 1.15, spreadMul: 0.8, fireRateMul: 1.3, moveMul: 0.76 },
  }),
];

export const WEAPONS = Object.fromEntries(LIST.map((w) => [w.id, w]));

/** 購入メニューの並び順 */
export const SHOP = ['サイドアーム', 'SMG', 'ショットガン', 'ライフル', 'スナイパー', 'ヘビー']
  .map((category) => ({ category, items: LIST.filter((w) => w.category === category) }));
