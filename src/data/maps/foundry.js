// マップ「ファウンドリー」。1 マス = 4m。上が北 (防衛側)、下が南 (攻撃側)
// '#' 建物  '.' 通路  '=' 屋根つき通路 (トンネル / 門)
// 'A'/'B' サイト  'd' 防衛スポーン  'a' 攻撃スポーン

const GRID = [
  '##############################',
  '##########dddddddddd##########',
  '##########dddddddddd##########',
  '##..........................##',
  '##==##########==##########==##',
  '##AAAAAAAA####..###BBBBBBBBB##',
  '##AAAAAAAA###....##BBBBBBBBB##',
  '##AAAAAAAA........#BBB##BBBB##',
  '##AAAAAAAA###....##BBB##BBBB##',
  '##AAAAAAAA###....====BBBBBBB##',
  '##AAAAAAAA####..###BBBBBBBBB##',
  '##..##########..##########..##',
  '##..##########..##########..##',
  '##..==========..##########..##',
  '##..##########..##########..##',
  '##..##########..####........##',
  '##..##########..####..########',
  '##......######..####..########',
  '##......######..####..########',
  '##....................########',
  '##########aaaaaaaaaa##########',
  '##########aaaaaaaaaa##########',
  '##########aaaaaaaaaa##########',
  '##############################',
];

// ---- 遮蔽物の部品。x,z は中心 (m)、w,d は幅と奥行き、h は高さ、y は底の高さ ----
const crate = (x, z, s = 1.4, y = 0) => ({ x, z, w: s, d: s, h: s, y, mat: 'wood' });
const stack = (x, z, s = 1.5) => [crate(x, z, s), crate(x + 0.1, z - 0.05, s * 0.75, s)];
const container = (x, z, alongZ = true) => ({ x, z, w: alongZ ? 2.5 : 6, d: alongZ ? 6 : 2.5, h: 2.6, mat: 'metal' });
const barrel = (x, z) => ({ x, z, w: 0.8, d: 0.8, h: 1.1, mat: 'metal' });
const lowWall = (x, z, w, d, y = 0, h = 1.2) => ({ x, z, w, d, h, y, mat: 'concrete' });
const block = (x, z, w, d, h, mat = 'concrete') => ({ x, z, w, d, h, mat });

/**
 * 高さ top の台に上る階段。(x, z) は台の縁の中心、(dx, dz) は台から離れる向き
 * 1 段 0.4m なので、歩くだけで上れる
 */
function stairs(x, z, dx, dz, top, width, run = 0.65) {
  const out = [], n = Math.round(top / 0.4) - 1;
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) * run;
    out.push({
      x: x + dx * c, z: z + dz * c,
      w: dx ? run : width, d: dz ? run : width,
      h: top - 0.4 * (k + 1), mat: 'concrete',
    });
  }
  return out;
}

const PROPS = [
  // ---- A サイト (x -52..-20, z -28..-4): 北西に低い台 ----
  block(-48, -24, 8, 8, 1.2),
  ...stairs(-44, -24, 1, 0, 1.2, 3),
  ...stairs(-48, -20, 0, 1, 1.2, 3),
  lowWall(-45.2, -20.2, 2.4, 0.4, 1.2, 0.9), lowWall(-44.2, -27, 0.4, 2, 1.2, 0.9),
  crate(-50.5, -26.5, 1.3, 1.2),
  container(-35, -17), ...stack(-27, -9), ...stack(-23.5, -25), crate(-30, -24),
  lowWall(-34, -6.5, 5, 0.8), barrel(-40.5, -12), barrel(-39.5, -12.4), barrel(-22, -14),
  // ---- B サイト (x 16..52, z -28..-4): 北東に高い台、中央に柱の建物 ----
  block(48, -24, 8, 8, 2.4),
  ...stairs(44, -24, -1, 0, 2.4, 3, 0.7),
  lowWall(44.2, -21.3, 0.4, 2.6, 2.4, 0.9), lowWall(47.5, -20.2, 7, 0.4, 2.4, 0.9),
  crate(50.5, -26.5, 1.3, 2.4),
  ...stack(26, -24), crate(38.5, -24.5), container(27, -6, false), ...stack(45, -9),
  lowWall(40, -15, 0.8, 5), barrel(37.2, -11), barrel(49, -15), barrel(50, -15.6),
  // ---- ミッド広場 (x -8..8, z -24..-8) ----
  block(0, -21, 2.2, 2.2, 5, 'sandstone'),
  crate(-6.5, -22.5), crate(6.3, -22.6, 1.6), lowWall(-5, -9, 4, 0.8), barrel(7, -14),
  // ---- ミッド下 (x -4..4) ----
  crate(-2.2, 10, 1.8), ...stack(2.4, -2), lowWall(0.2, 21, 3, 0.8), barrel(-3.2, 18),
  // ---- 連絡トンネル / A ショート / B トンネル ----
  crate(-20, 7), barrel(-33, 4.7), crate(-13, -17.2, 1.3), crate(21, -11),
  // ---- A ロング / A ロビー ----
  container(-50.5, 12), crate(-45.5, 2), ...stack(-34, 22), barrel(-45, 27), barrel(-44.2, 27.6),
  // ---- B メイン ----
  crate(50, 2), barrel(45, 9), ...stack(36, 13), crate(22, 24), barrel(27, 18),
  // ---- 攻撃側ロビー / 防衛側通路 ----
  crate(-30, 31), crate(-14, 29), crate(12, 29.2), barrel(4, 31.4),
  crate(-22, -35), crate(22, -33.2), barrel(-38, -35.4), barrel(40, -32.6),
].flat();

// 射撃場の的。move: 左右に動く
const TARGETS = [
  { x: 0, z: 25 },
  { x: -3, z: 16 },
  { x: 2.5, z: 3, armor: 50 },
  { x: 0, z: -11.5, move: { axis: 'x', range: 5, speed: 3.2 } },
  { x: -20, z: 30.4, move: { axis: 'x', range: 3.5, speed: 4.5 } },
  { x: 20, z: 30.6 },
  { x: -47, z: 26 },
  { x: -37, z: -10 },
  { x: -47, z: -23, y: 1.2, armor: 50 },
  { x: -30, z: -16, move: { axis: 'z', range: 4, speed: 3.2 } },
  { x: 40, z: -19 },
  { x: 46, z: -5.5, move: { axis: 'x', range: 3, speed: 5.5 } },
  { x: 48, z: -24, y: 2.4 },
];

export const FOUNDRY = {
  id: 'foundry',
  name: 'ファウンドリー',
  cell: 4,
  wallHeight: 7,
  roofY: 3.4, // '=' の屋根の下面
  grid: GRID,
  props: PROPS,
  targets: TARGETS,
  rangeSpawn: { x: 0, z: 40, yaw: 0 },
};
