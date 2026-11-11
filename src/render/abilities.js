import * as THREE from 'three';
import { canvasTexture } from './textures.js';

// アビリティで場に出ている物 (session.ents) の見た目。ID ごとにメッシュを作り、消えたら片付ける

const UNIT_SPHERE = new THREE.SphereGeometry(1, 20, 14);
const UNIT_DISC = new THREE.CylinderGeometry(1, 1, 1, 28);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const RING = new THREE.TorusGeometry(1, 0.03, 6, 40);

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts });
const glow = (color, opacity = 1, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, ...extra });

const MATS = {
  proj: glow(0xfff2b0),
  // 煙は中に入っても見通せないよう、両面を描く
  smoke: mat(0x9aa4b0, { side: THREE.DoubleSide, roughness: 1 }),
  fire: glow(0xff6a1a, 0.55, { side: THREE.DoubleSide }),
  slow: glow(0x7fd8ff, 0.4, { side: THREE.DoubleSide }),
  stim: glow(0x6bff8a, 0.28, { side: THREE.DoubleSide }),
  warn: glow(0xff3d3d, 0.9),
  strike: glow(0xff8a3c, 0.5, { side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  firewall: glow(0xff7a1a, 0.9, { side: THREE.DoubleSide }),
  ice: new THREE.MeshStandardMaterial({ color: 0xbfe9ff, roughness: 0.18, metalness: 0.1 }), // 向こうは見えない
  item: mat(0x2a2f38, { emissive: 0xffd23f, emissiveIntensity: 0.9 }),
  recon: glow(0xffe36b),
  drone: mat(0x2a2f38, { emissive: 0xffe36b, emissiveIntensity: 1.5 }),
  marker: glow(0x7fe3ff, 0.9),
  orb: glow(0xc77bff),
};

const markTex = canvasTexture(64, (ctx) => {
  ctx.clearRect(0, 0, 64, 64);
  ctx.translate(32, 32); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(255,60,60,0.9)'; ctx.fillRect(-14, -14, 28, 28);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(-14, -14, 28, 28);
});
// 索敵で見えた敵の印。壁越しに見える
const MARK_MAT = new THREE.SpriteMaterial({ map: markTex, depthTest: false, transparent: true });

function build(e) {
  switch (e.kind) {
    case 'proj': { const m = new THREE.Mesh(UNIT_SPHERE, MATS.proj); m.scale.setScalar(0.12); return m; }
    case 'smoke': { const m = new THREE.Mesh(UNIT_SPHERE, MATS.smoke); m.scale.setScalar(0.01); return m; }
    case 'fire': case 'slow': case 'stim': {
      const m = new THREE.Mesh(UNIT_DISC, MATS[e.kind]);
      m.scale.set(e.r, e.kind === 'fire' ? 0.5 : 0.08, e.r);
      return m;
    }
    case 'warn': { const m = new THREE.Mesh(RING, MATS.warn); m.rotation.x = Math.PI / 2; m.scale.setScalar(e.r); return m; }
    case 'strike': { const m = new THREE.Mesh(UNIT_DISC, MATS.strike); m.scale.set(e.r, 60, e.r); return m; }
    case 'firewall': {
      const len = Math.hypot(e.x2 - e.x, e.z2 - e.z);
      const m = new THREE.Mesh(UNIT_BOX, MATS.firewall);
      m.scale.set(0.35, 4.2, len);
      m.rotation.y = Math.atan2(e.x2 - e.x, e.z2 - e.z);
      return m;
    }
    case 'ice': { const m = new THREE.Mesh(UNIT_BOX, MATS.ice); m.scale.set(e.x2 * 2, e.r, e.z2 * 2); m.castShadow = true; return m; }
    case 'recon': { const m = new THREE.Mesh(UNIT_BOX, MATS.recon); m.scale.setScalar(0.18); return m; }
    case 'item': { const m = new THREE.Mesh(UNIT_BOX, MATS.item); m.scale.set(0.12, 0.14, e.w && e.w.startsWith('pistol') ? 0.35 : 0.8); return m; } // 落ちている武器
    case 'drone': { const m = new THREE.Mesh(UNIT_BOX, MATS.drone); m.scale.set(0.5, 0.18, 0.5); return m; }
    case 'marker': { const m = new THREE.Mesh(RING, MATS.marker); m.rotation.x = Math.PI / 2; m.scale.setScalar(e.r); return m; }
    case 'orb': { const m = new THREE.Mesh(UNIT_SPHERE, MATS.orb); m.scale.setScalar(e.r); return m; }
    case 'mark': { const s = new THREE.Sprite(MARK_MAT); s.scale.setScalar(0.7); s.renderOrder = 10; return s; }
  }
  return null;
}

export class AbilityViews {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.views = new Map();
    this.time = 0;
  }

  /** @param myTeam 索敵の印は、見える側のチームにだけ出す */
  sync(ents, myTeam, dt) {
    this.time += dt;
    for (const v of this.views.values()) v.seen = false;
    for (const e of ents) {
      if (e.kind === 'mark' && e.team !== myTeam) continue;
      let v = this.views.get(e.id);
      if (!v) {
        const mesh = build(e);
        if (!mesh) continue;
        v = { mesh, age: 0, kind: e.kind };
        this.views.set(e.id, v);
        this.scene.add(mesh);
      }
      v.seen = true; v.age += dt;
      const m = v.mesh;
      switch (e.kind) {
        case 'smoke': {
          // ふくらんで現れ、少し揺らぐ
          const grow = Math.min(1, v.age * 4), wob = 1 + Math.sin(this.time * 1.7 + e.x) * 0.02;
          m.position.set(e.x, e.y + e.r * 0.45, e.z);
          m.scale.set(e.r * grow * wob, e.r * grow * 0.9, e.r * grow * wob);
          break;
        }
        case 'fire':
          m.position.set(e.x, e.y + 0.25, e.z);
          if (Math.random() < dt * 40) this.flame(e.x + (Math.random() - 0.5) * e.r * 1.6, e.y, e.z + (Math.random() - 0.5) * e.r * 1.6);
          break;
        case 'slow': case 'stim': m.position.set(e.x, e.y + 0.05, e.z); break;
        case 'warn': m.position.set(e.x, e.y + 0.1, e.z); m.scale.setScalar(e.r * (0.6 + 0.4 * Math.abs(Math.sin(this.time * 9)))); break;
        case 'strike': m.position.set(e.x, e.y + 30, e.z); break;
        case 'firewall': {
          m.position.set((e.x + e.x2) / 2, e.y + 2.1, (e.z + e.z2) / 2);
          const k = Math.random();
          if (Math.random() < dt * 50) this.flame(e.x + (e.x2 - e.x) * k, e.y, e.z + (e.z2 - e.z) * k);
          break;
        }
        case 'ice': m.position.set(e.x, e.y + (e.r / 2) * Math.min(1, v.age * 5), e.z); m.scale.y = e.r * Math.min(1, v.age * 5); break;
        case 'marker': m.position.set(e.x, e.y + 0.08, e.z); m.rotation.z = this.time * 2; break;
        case 'item': m.position.set(e.x, e.y + 0.35 + Math.sin(this.time * 2 + e.x) * 0.05, e.z); m.rotation.y = this.time * 1.2; break;
        case 'orb': m.position.set(e.x, e.y + Math.sin(this.time * 2.4) * 0.12, e.z); break;
        default: m.position.set(e.x, e.y, e.z);
      }
    }
    for (const [id, v] of this.views) {
      if (v.seen) continue;
      this.scene.remove(v.mesh);
      this.views.delete(id);
    }
  }

  flame(x, y, z) {
    this.fx.particle(x, y + 0.1, z, (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.8,
      3.2, 1.2 + Math.random(), 0.25, 0.9, 0.22 + Math.random() * 0.2, 0.5 + Math.random() * 0.5, -1.5);
  }

  clear() {
    for (const v of this.views.values()) this.scene.remove(v.mesh);
    this.views.clear();
  }
}
