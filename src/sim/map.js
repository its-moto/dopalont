import { hash2 } from '../core/math.js';

const BUILDING_MATS = ['concrete', 'sandstone', 'painted', 'concrete', 'sandstone', 'metal'];
const MAX_CELLS = 5; // 建物 1 棟の最大マス数。細かく分けると高さと素材に変化が出る

/**
 * マップ定義 (文字グリッド + 遮蔽物) から、衝突と描画の両方で使う箱のリストを作る
 * 箱: { min:[x,y,z], max:[x,y,z], mat, kind:'floor'|'wall'|'prop', uv:'world'|'fit' }
 */
export function buildMap(def) {
  const { grid, cell } = def;
  const rows = grid.length, cols = grid[0].length;
  const ox = (-cols * cell) / 2, oz = (-rows * cell) / 2;
  const boxes = [];

  boxes.push({
    min: [ox - 4, -2, oz - 4], max: [ox + cols * cell + 4, 0, oz + rows * cell + 4],
    mat: 'sand', kind: 'floor', uv: 'world',
  });

  // 隣り合う '#' をまとめて箱の数を減らす
  const used = grid.map((row) => new Uint8Array(row.length));
  const solid = (r, c) => grid[r][c] === '#' && !used[r][c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solid(r, c)) continue;
      let w = 1;
      while (w < MAX_CELLS && c + w < cols && solid(r, c + w)) w++;
      let h = 1;
      grow: while (h < MAX_CELLS && r + h < rows) {
        for (let k = 0; k < w; k++) if (!solid(r + h, c + k)) break grow;
        h++;
      }
      for (let i = 0; i < h; i++) for (let k = 0; k < w; k++) used[r + i][c + k] = 1;
      const height = def.wallHeight + Math.floor(hash2(c * 3 + 1, r * 7 + 2) * 4);
      const mat = BUILDING_MATS[Math.floor(hash2(c + 11, r + 5) * BUILDING_MATS.length)];
      boxes.push({
        min: [ox + c * cell, 0, oz + r * cell],
        max: [ox + (c + w) * cell, height, oz + (r + h) * cell],
        mat, kind: 'wall', uv: 'world',
      });
    }
  }

  for (const p of def.props || []) {
    const y = p.y || 0;
    boxes.push({
      min: [p.x - p.w / 2, y, p.z - p.d / 2], max: [p.x + p.w / 2, y + p.h, p.z + p.d / 2],
      mat: p.mat, kind: 'prop', uv: p.mat === 'wood' ? 'fit' : 'world',
    });
  }

  // スポーンとサイトの範囲を文字から拾う
  const spawns = { attack: [], defense: [] };
  const sites = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      const x0 = ox + c * cell, z0 = oz + r * cell;
      if (ch === 'a') spawns.attack.push({ x: x0 + cell / 2, z: z0 + cell / 2 });
      else if (ch === 'd') spawns.defense.push({ x: x0 + cell / 2, z: z0 + cell / 2 });
      else if (ch === 'A' || ch === 'B') {
        const s = (sites[ch] ??= { min: [Infinity, Infinity], max: [-Infinity, -Infinity] });
        s.min[0] = Math.min(s.min[0], x0); s.min[1] = Math.min(s.min[1], z0);
        s.max[0] = Math.max(s.max[0], x0 + cell); s.max[1] = Math.max(s.max[1], z0 + cell);
      }
    }
  }

  return { def, boxes, spawns, sites, size: [cols * cell, rows * cell] };
}
