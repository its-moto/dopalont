import { hash2 } from '../core/math.js';

const BUILDING_MATS = ['concrete', 'sandstone', 'painted', 'brick', 'plaster', 'sandstone', 'brick', 'metal', 'plaster'];
const MAX_WALL = 12;     // 建物 1 棟の最大サイズ (m)。細かく分けると高さと素材に変化が出る
const ROOF_CLEAR = 3.4;  // 屋根つきエリアの天井の高さ (床から)
const SOLID = -1;

function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 同じ値が並ぶマスをまとめて、箱の数を減らす */
function merge(grid, cols, rows, keyOf, max, emit) {
  const used = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (used[i]) continue;
      const key = keyOf(grid[i]);
      if (key === null) continue;
      const same = (rr, cc) => !used[rr * cols + cc] && keyOf(grid[rr * cols + cc]) === key;
      let w = 1;
      while (w < max && c + w < cols && same(r, c + w)) w++;
      let h = 1;
      grow: while (h < max && r + h < rows) {
        for (let k = 0; k < w; k++) if (!same(r + h, c + k)) break grow;
        h++;
      }
      for (let a = 0; a < h; a++) for (let k = 0; k < w; k++) used[(r + a) * cols + c + k] = 1;
      emit(c, r, w, h, grid[i]);
    }
  }
}

/**
 * マップ定義から、衝突と描画の両方で使う箱のリストを作る
 *
 * 定義は「全部が建物で埋まった土地から、歩けるエリアをくり抜く」形で書く (1 マス = 1m)
 *   areas:  { name, x0, z0, x1, z1, h?, roof?, site?, spawn?, poly? }  h は床の高さ。後に書いたものが上書きする
 *           poly: [[x,z],...] を渡すと、その多角形の形にくり抜く (斜めの通路。壁は 1m 刻みのギザギザになる)
 *   ramps:  { x0, z0, x1, z1, up, from, to }  up ('+x' '-x' '+z' '-z') の向きに from → to へ上る坂 (0.4m ずつの段)
 *   solids: { x0, z0, x1, z1 }  くり抜いた中に残す柱や建物
 *   props:  遮蔽物の箱
 *
 * 箱: { min:[x,y,z], max:[x,y,z], mat, kind:'floor'|'wall'|'roof'|'prop', uv:'world'|'fit' }
 */
export function buildMap(def) {
  const [bx0, bz0, bx1, bz1] = def.bounds;
  const cols = bx1 - bx0, rows = bz1 - bz0;
  const H = new Float32Array(cols * rows).fill(SOLID);
  const set = (x, z, h) => { if (x >= bx0 && x < bx1 && z >= bz0 && z < bz1) H[(z - bz0) * cols + (x - bx0)] = h; };
  const fill = (a, h) => {
    for (let z = a.z0; z < a.z1; z++) for (let x = a.x0; x < a.x1; x++) {
      if (!a.poly || inPoly(a.poly, x + 0.5, z + 0.5)) set(x, z, h);
    }
  };

  for (const a of def.areas) fill(a, a.h || 0);
  for (const r of def.ramps || []) {
    const alongX = r.up[1] === 'x', n = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    for (let z = r.z0; z < r.z1; z++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = r.up === '+x' ? x - r.x0 : r.up === '-x' ? r.x1 - 1 - x : r.up === '+z' ? z - r.z0 : r.z1 - 1 - z;
        set(x, z, Math.round((r.from + ((r.to - r.from) * (i + 1)) / n) * 100) / 100);
      }
    }
  }
  for (const s of def.solids || []) fill(s, SOLID);

  const boxes = [{ min: [bx0 - 4, -2, bz0 - 4], max: [bx1 + 4, 0, bz1 + 4], mat: 'sand', kind: 'floor', uv: 'world' }];

  // 建物
  merge(H, cols, rows, (v) => (v === SOLID ? 'w' : null), MAX_WALL, (c, r, w, h) => {
    boxes.push({
      min: [bx0 + c, 0, bz0 + r],
      max: [bx0 + c + w, def.wallHeight + Math.floor(hash2(c * 3 + 1, r * 7 + 2) * 4), bz0 + r + h],
      mat: BUILDING_MATS[Math.floor(hash2(c + 11, r + 5) * BUILDING_MATS.length)], kind: 'wall', uv: 'world',
    });
  });
  // 台と坂 (床が地面より高いマス)
  merge(H, cols, rows, (v) => (v > 0 ? v : null), 64, (c, r, w, h, v) => {
    boxes.push({ min: [bx0 + c, 0, bz0 + r], max: [bx0 + c + w, v, bz0 + r + h], mat: 'concrete', kind: 'prop', uv: 'world' });
  });

  const spawns = { attack: [], defense: [] };
  const sites = {};
  for (const a of def.areas) {
    if (a.roof) {
      boxes.push({
        min: [a.x0, (a.h || 0) + ROOF_CLEAR, a.z0], max: [a.x1, def.wallHeight + 1, a.z1],
        mat: 'concrete', kind: 'roof', uv: 'world',
      });
    }
    if (a.site) sites[a.site] = { min: [a.x0, a.z0], max: [a.x1, a.z1] };
    if (a.spawn) {
      for (let z = a.z0 + 2; z <= a.z1 - 2; z += 3) for (let x = a.x0 + 2; x <= a.x1 - 2; x += 3) spawns[a.spawn].push({ x, z });
    }
  }

  for (const p of def.props || []) {
    const y = p.y || 0;
    boxes.push({
      min: [p.x - p.w / 2, y, p.z - p.d / 2], max: [p.x + p.w / 2, y + p.h, p.z + p.d / 2],
      mat: p.mat, kind: 'prop', uv: p.mat === 'wood' ? 'fit' : 'world',
    });
  }

  return { def, boxes, spawns, sites, areas: def.areas, size: [cols, rows], origin: [bx0, bz0], heights: H };
}

/** その位置のエリア名 (HUD の現在地表示用)。どこでもなければ '' */
export function areaAt(map, x, z) {
  for (let i = map.areas.length - 1; i >= 0; i--) {
    const a = map.areas[i];
    if (x >= a.x0 && x < a.x1 && z >= a.z0 && z < a.z1 && (!a.poly || inPoly(a.poly, x, z))) return a.name;
  }
  return '';
}

/** その位置の床の高さ (m)。建物の中なら -1 */
export function floorAt(map, x, z) {
  const cx = Math.floor(x) - map.origin[0], cz = Math.floor(z) - map.origin[1];
  if (cx < 0 || cz < 0 || cx >= map.size[0] || cz >= map.size[1]) return -1;
  return map.heights[cz * map.size[0] + cx];
}
