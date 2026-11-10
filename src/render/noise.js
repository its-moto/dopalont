import { mulberry32 } from '../core/math.js';

/**
 * 継ぎ目なく繰り返せる (周期つき) バリューノイズ
 * x, y は格子単位。px, py が周期 (整数)
 */
export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const P = new Uint8Array(512), V = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; V[i] = rnd(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = P[i]; P[i] = P[j]; P[j] = t;
  }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const lat = (ix, iy) => V[P[P[ix & 255] + (iy & 255)]];
  const wrap = (i, p) => ((i % p) + p) % p;

  function v(x, y, px, py) {
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    const x0 = wrap(xf, px), x1 = wrap(xf + 1, px), y0 = wrap(yf, py), y1 = wrap(yf + 1, py);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = lat(x0, y0), b = lat(x1, y0), c = lat(x0, y1), d = lat(x1, y1);
    return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy;
  }

  function fbm(x, y, oct, px, py) {
    let amp = 0.5, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += amp * v(x, y, px, py);
      norm += amp;
      x *= 2; y *= 2; px *= 2; py *= 2; amp *= 0.5;
    }
    return sum / norm;
  }

  return { v, fbm, hash: lat };
}
