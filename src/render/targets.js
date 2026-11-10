import * as THREE from 'three';
import { lerp } from '../core/math.js';

// 射撃場の的 (人型のダミー)。図形の組み合わせで作る

const GEO = {
  leg: new THREE.BoxGeometry(0.2, 0.85, 0.24),
  torso: new THREE.BoxGeometry(0.56, 0.62, 0.34),
  arm: new THREE.BoxGeometry(0.15, 0.6, 0.18),
  head: new THREE.IcosahedronGeometry(0.17, 1),
  visor: new THREE.BoxGeometry(0.24, 0.07, 0.1),
  plate: new THREE.BoxGeometry(0.44, 0.34, 0.06),
};

export class TargetViews {
  constructor(scene, world) {
    this.world = world;
    this.views = new Map();
    for (const t of world.targets) {
      const armored = t.maxArmor > 0;
      const body = new THREE.MeshStandardMaterial({ color: armored ? 0x2a3442 : 0x3a3038, roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0 });
      const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: armored ? 0x35a8ff : 0xff5a3c, emissiveIntensity: 2.4 });
      const g = new THREE.Group();
      const add = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
        return m;
      };
      add(GEO.leg, body, -0.14, 0.425, 0); add(GEO.leg, body, 0.14, 0.425, 0);
      add(GEO.torso, body, 0, 1.17, 0);
      add(GEO.arm, body, -0.37, 1.16, 0); add(GEO.arm, body, 0.37, 1.16, 0);
      add(GEO.head, body, 0, 1.64, 0);
      add(GEO.visor, glow, 0, 1.66, 0.13); add(GEO.visor, glow, 0, 1.66, -0.13);
      add(GEO.plate, glow, 0, 1.2, 0.16).scale.set(0.5, 0.25, 1);
      add(GEO.plate, glow, 0, 1.2, -0.16).scale.set(0.5, 0.25, 1);
      scene.add(g);
      this.views.set(t.id, { t, g, body, flash: 0, dying: 0, pop: 0 });
    }
  }

  onHit(id) { const v = this.views.get(id); if (v) v.flash = 1; }
  onKill(id) { const v = this.views.get(id); if (v) v.dying = 0.22; }
  onRespawn(id) { const v = this.views.get(id); if (v) { v.pop = 0.2; v.dying = 0; } }

  update(dt, alpha) {
    for (const v of this.views.values()) {
      const { t, g } = v;
      g.position.set(lerp(t.prev.x, t.pos.x, alpha), t.pos.y, lerp(t.prev.z, t.pos.z, alpha));
      v.flash = Math.max(0, v.flash - dt * 9);
      v.body.emissiveIntensity = v.flash * 0.9;
      if (v.dying > 0) {
        v.dying -= dt;
        const k = Math.max(0, v.dying / 0.22);
        g.visible = k > 0;
        g.scale.set(1 + (1 - k) * 0.5, k, 1 + (1 - k) * 0.5);
      } else if (!t.alive) {
        g.visible = false;
      } else {
        g.visible = true;
        v.pop = Math.max(0, v.pop - dt);
        const k = 1 - v.pop / 0.2;
        g.scale.set(1, k, 1);
      }
    }
  }
}
