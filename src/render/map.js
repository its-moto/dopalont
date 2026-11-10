import * as THREE from 'three';
import { canvasTexture } from './textures.js';

const AO_DARK = 0.5;   // 壁の根元をどれだけ暗くするか (接地感を出す)
const AO_HEIGHT = 1.4; // 暗がりが消える高さ (m)

class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  quad(p0, p1, p2, p3, n, uvs, cols) {
    const base = this.pos.length / 3;
    const ps = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      this.pos.push(ps[i][0], ps[i][1], ps[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(cols[i], cols[i], cols[i]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** 箱 1 個ぶんの面を追加する。底面は見えないので作らない */
function addBox(gb, b, meters) {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  const fit = b.uv === 'fit';
  const s = fit ? 1 : 1 / meters;

  // 上面
  const tu = fit ? [[0, 1], [1, 1], [1, 0], [0, 0]] : [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]];
  gb.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], tu, [1, 1, 1, 1]);
  if (b.kind === 'floor') return;

  // 側面。a → b が面の横方向 (外から見て反時計回りになる順)
  const sides = [
    { a: [x1, z1], b: [x1, z0], n: [1, 0, 0], h: 1 },
    { a: [x0, z0], b: [x0, z1], n: [-1, 0, 0], h: 1 },
    { a: [x0, z1], b: [x1, z1], n: [0, 0, 1], h: 0 },
    { a: [x1, z0], b: [x0, z0], n: [0, 0, -1], h: 0 },
  ];
  const grounded = y0 <= 0.01;
  for (const f of sides) {
    const ua = fit ? 0 : f.a[f.h] * s, ub = fit ? 1 : f.b[f.h] * s;
    const strip = (ya, yb, ca, cb) => {
      const va = fit ? (ya - y0) / (y1 - y0) : ya * s, vb = fit ? (yb - y0) / (y1 - y0) : yb * s;
      gb.quad([f.a[0], ya, f.a[1]], [f.b[0], ya, f.b[1]], [f.b[0], yb, f.b[1]], [f.a[0], yb, f.a[1]],
        f.n, [[ua, va], [ub, va], [ub, vb], [ua, vb]], [ca, ca, cb, cb]);
    };
    const dark = grounded ? AO_DARK : 0.8;
    if (y1 - y0 > AO_HEIGHT + 0.5) {
      strip(y0, y0 + AO_HEIGHT, dark, 1);
      strip(y0 + AO_HEIGHT, y1, 1, 1);
    } else {
      strip(y0, y1, dark, 1);
    }
  }
}

function siteLabel(letter) {
  return canvasTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,214,90,0.85)';
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, s - 28, s - 28);
    ctx.fillStyle = 'rgba(255,214,90,0.9)';
    ctx.font = 'bold 170px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, s / 2, s / 2 + 10);
  });
}

/** マップの箱を素材ごとに 1 メッシュへまとめる (描画回数を減らす) */
export function buildMapMeshes(map, materials) {
  const group = new THREE.Group();
  const builders = {};
  for (const b of map.boxes) {
    const gb = (builders[b.mat] ??= new GeoBuilder());
    addBox(gb, b, materials[b.mat].userData.meters);
  }
  for (const mat in builders) {
    const mesh = new THREE.Mesh(builders[mat].build(), materials[mat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // サイトの床 (タイル) と文字
  const tile = materials.tile.clone();
  tile.polygonOffset = true; tile.polygonOffsetFactor = -1; tile.polygonOffsetUnits = -1;
  for (const name in map.sites) {
    const s = map.sites[name];
    const gb = new GeoBuilder();
    const [x0, z0] = s.min, [x1, z1] = s.max, k = 1 / tile.userData.meters, y = 0.01;
    gb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0],
      [[x0 * k, z1 * k], [x1 * k, z1 * k], [x1 * k, z0 * k], [x0 * k, z0 * k]], [1, 1, 1, 1]);
    const floor = new THREE.Mesh(gb.build(), tile);
    floor.receiveShadow = true;
    group.add(floor);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ map: siteLabel(name), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    group.add(label);
  }
  return group;
}
