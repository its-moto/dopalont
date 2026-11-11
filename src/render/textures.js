import * as THREE from 'three';
import { clamp, lerp, smooth } from '../core/math.js';
import { makeNoise } from './noise.js';

// 素材ごとのレシピ。fn(u, v, noise, out) が 1 ピクセルの色 (0..1)・高さ・粗さを書き込む
// u, v は 0..1 で、上下左右がつながるように作る (wood だけは箱の面にぴったり貼る)
// meters: テクスチャ 1 枚が何 m ぶんか

const TAU = Math.PI * 2;
const lineDist = (x, n) => Math.abs(x * n - Math.round(x * n)) / n; // 最も近い目地までの距離

/** 波板の金属 (コンテナや倉庫の壁)。paint は塗装の色。錆が浮く */
function corrugated(seed, paint) {
  return {
    meters: 3, seed, bump: 3.0, metalness: 0.35,
    fn(u, v, n, o) {
      const rib = 0.5 + 0.5 * Math.cos(u * TAU * 12);
      const rn = n.fbm(u * 5 + 2, v * 5 + 8, 5, 5, 5) + (n.fbm(u * 20, v * 2 + 4, 2, 20, 2) - 0.5) * 0.3;
      const rust = smooth(0.55, 0.68, rn);
      const g = n.fbm(u * 64, v * 64, 2, 64, 64);
      const pk = 0.8 + rib * 0.3;
      o.r = lerp(paint[0] * pk, 0.36 + g * 0.14, rust);
      o.g = lerp(paint[1] * pk, 0.2 + g * 0.07, rust);
      o.b = lerp(paint[2] * pk, 0.09, rust);
      o.h = rib + rust * g * 0.3;
      o.rough = lerp(0.42, 0.95, rust);
    },
  };
}

const RECIPES = {
  concrete: {
    meters: 4, seed: 11, bump: 2.4, metalness: 0,
    fn(u, v, n, o) {
      const m = n.fbm(u * 4, v * 4, 5, 4, 4);
      const g = n.fbm(u * 48 + 7, v * 48, 2, 48, 48);
      const crackZone = smooth(0.6, 0.74, n.fbm(u * 2 + 5, v * 2 + 5, 2, 2, 2));
      const crack = (1 - smooth(0, 0.009, Math.abs(n.fbm(u * 3 + 31, v * 3 + 13, 4, 3, 3) - 0.5))) * crackZone;
      const seam = 1 - smooth(0.002, 0.007, Math.min(lineDist(u, 2), lineDist(v, 2)));
      const streak = smooth(0.56, 0.8, n.fbm(u * 24 + 3, v * 3 + 9, 3, 24, 3));
      const c = 0.62 + (m - 0.5) * 0.3 + (g - 0.5) * 0.1 - crack * 0.2 - seam * 0.26 - streak * 0.1;
      o.r = c; o.g = c * 0.985; o.b = c * 0.95;
      o.h = m * 0.5 + g * 0.2 - crack * 0.8 - seam * 0.9;
      o.rough = 0.84 + (g - 0.5) * 0.2;
    },
  },

  sandstone: {
    meters: 4, seed: 23, bump: 2.6, metalness: 0,
    fn(u, v, n, o) {
      const row = Math.floor(v * 8), fv = v * 8 - row;
      const uu = u * 4 + (row & 1) * 0.5, bi = Math.floor(uu), fu = uu - bi;
      const d = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv) * 0.5); // m 単位
      const mortar = 1 - smooth(0.008, 0.022, d);
      const bevel = smooth(0, 0.06, d);
      const tone = n.hash((bi & 3) + row * 7, row + 3);
      const strata = n.fbm(u * 3, v * 40 + 5, 3, 3, 40);
      const g = n.fbm(u * 64, v * 64, 2, 64, 64);
      const pit = smooth(0.7, 0.8, n.v(u * 40 + 9, v * 40 + 2, 40, 40));
      const c = (0.9 + (tone - 0.5) * 0.18 + (strata - 0.5) * 0.2 + (g - 0.5) * 0.1 - pit * 0.08) * (1 - mortar * 0.42);
      o.r = c * 0.86; o.g = c * 0.7; o.b = c * 0.5;
      o.h = bevel * 0.8 + strata * 0.25 + g * 0.15 - pit * 0.3;
      o.rough = 0.92;
    },
  },

  painted: {
    meters: 4, seed: 37, bump: 2.0, metalness: 0,
    fn(u, v, n, o) {
      const chipN = n.fbm(u * 6 + 3, v * 6, 5, 6, 6);
      const chip = smooth(0.6, 0.63, chipN);
      const ring = smooth(0.55, 0.6, chipN) * (1 - chip);
      const tone = n.fbm(u * 3 + 9, v * 3 + 2, 3, 3, 3);
      const g = n.fbm(u * 64, v * 64, 2, 64, 64);
      const band = 1 - smooth(0.004, 0.012, lineDist(v, 1)); // 塗装の境目の線
      const pk = (0.82 + tone * 0.36) * (1 - ring * 0.25) * (1 - band * 0.2);
      const pl = 0.82 + g * 0.3;
      o.r = lerp(0.2 * pk, 0.74 * pl, chip);
      o.g = lerp(0.47 * pk, 0.69 * pl, chip);
      o.b = lerp(0.5 * pk, 0.62 * pl, chip);
      o.h = (1 - chip) * 0.6 + g * 0.15 - band * 0.2;
      o.rough = lerp(0.5, 0.92, chip);
    },
  },

  metal: corrugated(41, [0.27, 0.36, 0.45]),
  metal2: corrugated(43, [0.78, 0.56, 0.14]),

  wood: {
    meters: 0, seed: 53, bump: 2.6, metalness: 0, size: 256,
    fn(u, v, n, o) {
      const pi = Math.floor(u * 5), fu = u * 5 - pi;
      const gap = 1 - smooth(0, 0.05, Math.min(fu, 1 - fu));
      const gr = n.fbm(u * 40 + pi * 17, v * 4, 4, 256, 256);
      const border = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
      const frame = Math.max(1 - smooth(0.09, 0.1, border), 1 - smooth(0.055, 0.065, Math.abs(u - v)));
      const fg = n.fbm(u * 6, v * 60 + 9, 3, 256, 256);
      let nail = 0;
      for (const [nx, ny] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95], [0.5, 0.05], [0.5, 0.95], [0.05, 0.5], [0.95, 0.5]]) {
        nail = Math.max(nail, 1 - smooth(0.01, 0.016, Math.hypot(u - nx, v - ny)));
      }
      const pt = (0.72 + gr * 0.5 + (n.hash(pi, 3) - 0.5) * 0.22) * (1 - gap * 0.55);
      const ft = 0.85 + fg * 0.3;
      const k = 1 - nail * 0.7;
      o.r = lerp(0.56 * pt, 0.68 * ft, frame) * k;
      o.g = lerp(0.38 * pt, 0.5 * ft, frame) * k;
      o.b = lerp(0.21 * pt, 0.3 * ft, frame) * k;
      o.h = lerp(0.35 + gr * 0.25 - gap * 0.5, 1 + fg * 0.15, frame) + nail * 0.2;
      o.rough = 0.8;
    },
  },

  brick: {
    meters: 4, seed: 91, bump: 2.6, metalness: 0,
    fn(u, v, n, o) {
      const row = Math.floor(v * 16), fv = v * 16 - row;
      const uu = u * 8 + (row & 1) * 0.5, bi = Math.floor(uu), fu = uu - bi;
      const d = Math.min(Math.min(fu, 1 - fu) * 0.5, Math.min(fv, 1 - fv) * 0.25); // m 単位
      const mortar = 1 - smooth(0.006, 0.016, d);
      const tone = n.hash((bi & 7) + row * 5, row + 9);
      const g = n.fbm(u * 64, v * 64, 2, 64, 64);
      const stain = n.fbm(u * 3 + 4, v * 3 + 7, 3, 3, 3);
      const c = 0.8 + (tone - 0.5) * 0.4 + (g - 0.5) * 0.14 + (stain - 0.5) * 0.2;
      o.r = lerp(0.62 * c, 0.66, mortar); o.g = lerp(0.27 * c, 0.63, mortar); o.b = lerp(0.2 * c, 0.58, mortar);
      o.h = smooth(0, 0.03, d) * 0.9 + g * 0.2;
      o.rough = 0.9;
    },
  },

  plaster: {
    meters: 4, seed: 97, bump: 1.6, metalness: 0,
    fn(u, v, n, o) {
      const m = n.fbm(u * 3, v * 3, 4, 3, 3);
      const g = n.fbm(u * 80, v * 80, 2, 80, 80);
      const streak = smooth(0.55, 0.8, n.fbm(u * 20 + 3, v * 2 + 5, 3, 20, 2));
      const crack = 1 - smooth(0, 0.007, Math.abs(n.fbm(u * 3 + 11, v * 3 + 2, 4, 3, 3) - 0.5));
      const zone = smooth(0.62, 0.75, n.fbm(u * 2 + 1, v * 2 + 9, 2, 2, 2));
      const c = 0.95 + (m - 0.5) * 0.16 + (g - 0.5) * 0.08 - streak * 0.12 - crack * zone * 0.3;
      o.r = c * 0.9; o.g = c * 0.85; o.b = c * 0.73;
      o.h = m * 0.3 + g * 0.3 - crack * zone * 0.6;
      o.rough = 0.88;
    },
  },

  tarp: {
    meters: 2, seed: 101, bump: 2.4, metalness: 0,
    fn(u, v, n, o) {
      const fold = n.fbm(u * 4, v * 4, 4, 4, 4);
      const ridge = 1 - Math.abs(fold - 0.5) * 2;
      const weave = 0.5 + 0.25 * Math.sin(u * TAU * 96) + 0.25 * Math.sin(v * TAU * 96);
      const c = 0.75 + ridge * 0.35 + (weave - 0.5) * 0.12;
      o.r = c * 0.3; o.g = c * 0.4; o.b = c * 0.27;
      o.h = ridge * 0.9 + weave * 0.08;
      o.rough = 0.7;
    },
  },

  sandbag: {
    meters: 2, seed: 103, bump: 3.0, metalness: 0,
    fn(u, v, n, o) {
      const row = Math.floor(v * 8), fv = v * 8 - row;
      const uu = u * 4 + (row & 1) * 0.5, bi = Math.floor(uu), fu = uu - bi;
      const bulge = Math.sin(fu * Math.PI) * Math.sin(fv * Math.PI); // 袋のふくらみ
      const seam = 1 - smooth(0.05, 0.25, bulge);
      const weave = 0.5 + 0.25 * Math.sin(u * TAU * 120) + 0.25 * Math.sin(v * TAU * 120);
      const tone = n.hash((bi & 3) + row * 3, row + 21);
      const c = (0.72 + (tone - 0.5) * 0.2 + bulge * 0.3 + (weave - 0.5) * 0.14) * (1 - seam * 0.45);
      o.r = c * 0.74; o.g = c * 0.64; o.b = c * 0.46;
      o.h = Math.sqrt(Math.max(0, bulge)) + weave * 0.05;
      o.rough = 0.95;
    },
  },

  planks: {
    meters: 4, seed: 107, bump: 2.0, metalness: 0,
    fn(u, v, n, o) {
      const bi = Math.floor(v * 12), fv = v * 12 - bi;
      const gap = 1 - smooth(0, 0.06, Math.min(fv, 1 - fv));
      const shift = n.hash(bi, 17) * 4;
      const end = 1 - smooth(0, 0.006, lineDist(u + shift * 0.25, 1)); // 板の継ぎ目
      const gr = n.fbm(u * 6 + bi * 7, v * 96, 4, 256, 256);
      const tone = n.hash(bi, 5);
      const c = (0.68 + gr * 0.42 + (tone - 0.5) * 0.24) * (1 - gap * 0.6) * (1 - end * 0.5);
      o.r = c * 0.52; o.g = c * 0.37; o.b = c * 0.23;
      o.h = 0.6 - gap * 0.6 - end * 0.4 + gr * 0.15;
      o.rough = 0.72;
    },
  },

  asphalt: {
    meters: 5, seed: 109, bump: 1.6, metalness: 0,
    fn(u, v, n, o) {
      const m = n.fbm(u * 3, v * 3, 4, 3, 3);
      const g = n.v(u * 128 + 3, v * 128 + 7, 128, 128);
      const stone = smooth(0.78, 0.9, n.v(u * 90 + 11, v * 90 + 5, 90, 90));
      const crack = (1 - smooth(0, 0.008, Math.abs(n.fbm(u * 4 + 9, v * 4 + 3, 4, 4, 4) - 0.5))) * smooth(0.55, 0.7, n.fbm(u * 2 + 3, v * 2, 2, 2, 2));
      const patch = smooth(0.6, 0.64, n.fbm(u * 2 + 13, v * 2 + 6, 3, 2, 2)); // 補修の跡
      const c = 0.27 + (m - 0.5) * 0.12 + (g - 0.5) * 0.08 + stone * 0.16 - crack * 0.16 - patch * 0.06;
      o.r = c; o.g = c; o.b = c * 1.04;
      o.h = g * 0.25 + stone * 0.4 - crack * 0.8;
      o.rough = 0.9 - patch * 0.15;
    },
  },

  sand: {
    meters: 6, seed: 67, bump: 1.8, metalness: 0,
    fn(u, v, n, o) {
      const m = n.fbm(u * 3, v * 3, 5, 3, 3);
      const rip = 0.5 + 0.5 * Math.sin((v * 36 + n.fbm(u * 4 + 3, v * 4, 3, 4, 4) * 5) * TAU);
      const g = n.fbm(u * 96, v * 96, 2, 96, 96);
      const peb = smooth(0.8, 0.87, n.v(u * 72 + 5, v * 72 + 3, 72, 72));
      const dark = smooth(0.55, 0.75, n.fbm(u * 2 + 7, v * 2 + 1, 3, 2, 2));
      const c = 0.92 + (m - 0.5) * 0.36 + (g - 0.5) * 0.12 + (rip - 0.5) * 0.05 - peb * 0.26 - dark * 0.1;
      o.r = c * 0.8; o.g = c * 0.67; o.b = c * 0.48;
      o.h = m * 0.4 + rip * 0.1 + peb * 0.8 + g * 0.1;
      o.rough = 0.96;
    },
  },

  tile: {
    meters: 4, seed: 79, bump: 2.2, metalness: 0,
    fn(u, v, n, o) {
      const ti = Math.floor(u * 8), tj = Math.floor(v * 8);
      const fu = u * 8 - ti, fv = v * 8 - tj;
      const grout = 1 - smooth(0.02, 0.05, Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv)));
      const tone = n.hash(ti, tj + 40);
      const wear = n.fbm(u * 6, v * 6, 4, 6, 6);
      const g = n.fbm(u * 64, v * 64, 2, 64, 64);
      const c = (0.6 + (tone - 0.5) * 0.16 + (wear - 0.5) * 0.24 + (g - 0.5) * 0.06) * (1 - grout * 0.5);
      o.r = c * 0.95; o.g = c * 0.97; o.b = c;
      o.h = (1 - grout) * 0.8 + g * 0.1;
      o.rough = lerp(0.5 + wear * 0.35, 0.95, grout);
    },
  },
};

export const MATERIAL_NAMES = Object.keys(RECIPES);

function dataTex(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** レシピを焼いて、色・法線・粗さの 3 枚を作る */
function bake(recipe) {
  const size = recipe.size || 512, mask = size - 1;
  const n = makeNoise(recipe.seed);
  const col = new Uint8Array(size * size * 4);
  const rgh = new Uint8Array(size * size * 4);
  const nrm = new Uint8Array(size * size * 4);
  const hgt = new Float32Array(size * size);
  const o = { r: 0, g: 0, b: 0, h: 0, rough: 0.8 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      recipe.fn(x / size, y / size, n, o);
      const i = y * size + x, k = i * 4;
      col[k] = clamp(o.r, 0, 1) * 255; col[k + 1] = clamp(o.g, 0, 1) * 255; col[k + 2] = clamp(o.b, 0, 1) * 255; col[k + 3] = 255;
      const r = clamp(o.rough, 0, 1) * 255;
      rgh[k] = r; rgh[k + 1] = r; rgh[k + 2] = r; rgh[k + 3] = 255;
      hgt[i] = o.h;
    }
  }

  // 高さの傾きから法線を作る
  const s = recipe.bump;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = hgt[y * size + ((x - 1) & mask)], r = hgt[y * size + ((x + 1) & mask)];
      const d = hgt[((y - 1) & mask) * size + x], u = hgt[((y + 1) & mask) * size + x];
      let nx = (l - r) * s, ny = (d - u) * s;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nx *= inv; ny *= inv;
      const k = (y * size + x) * 4;
      nrm[k] = (nx * 0.5 + 0.5) * 255; nrm[k + 1] = (ny * 0.5 + 0.5) * 255; nrm[k + 2] = (inv * 0.5 + 0.5) * 255; nrm[k + 3] = 255;
    }
  }

  return { map: dataTex(col, size, true), normalMap: dataTex(nrm, size, false), roughnessMap: dataTex(rgh, size, false) };
}

/**
 * 全素材の MeshStandardMaterial を作る。重いので 1 素材ごとに画面へ制御を返す
 * @returns {Promise<Record<string, THREE.MeshStandardMaterial & {userData:{meters:number}}>>}
 */
export async function createMaterials(onProgress) {
  const out = {};
  for (let i = 0; i < MATERIAL_NAMES.length; i++) {
    const name = MATERIAL_NAMES[i], recipe = RECIPES[name];
    const tex = bake(recipe);
    const m = new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap,
      roughness: 1, metalness: recipe.metalness, vertexColors: true,
    });
    m.userData.meters = recipe.meters;
    out[name] = m;
    onProgress?.((i + 1) / MATERIAL_NAMES.length, name);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/** 小さなキャンバスに描いてテクスチャにする (弾痕、マズルフラッシュ、文字など) */
export function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
