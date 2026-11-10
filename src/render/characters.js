import * as THREE from 'three';
import { canvasTexture } from './textures.js';

// 他プレイヤーの見た目。図形の組み合わせで、味方は青、敵は赤く光る

const GEO = {
  leg: new THREE.BoxGeometry(0.2, 0.85, 0.24),
  torso: new THREE.BoxGeometry(0.56, 0.62, 0.34),
  arm: new THREE.BoxGeometry(0.15, 0.5, 0.18),
  head: new THREE.IcosahedronGeometry(0.17, 1),
  visor: new THREE.BoxGeometry(0.26, 0.07, 0.12),
  stripe: new THREE.BoxGeometry(0.22, 0.08, 0.36),
  gun: new THREE.BoxGeometry(0.07, 0.1, 0.7),
};
const GUN_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 });
const CROUCH_SCALE = 0.7;

function nameTag(name) {
  const tex = canvasTexture(256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    ctx.font = 'bold 34px "Bahnschrift", "BIZ UDGothic", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(name, 128, 128);
    ctx.fillStyle = '#8fe3ff';
    ctx.fillText(name, 128, 128);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.6, 1.6, 1);
  s.position.y = 2.15;
  return s;
}

function build(r, ally) {
  const body = new THREE.MeshStandardMaterial({ color: ally ? 0x25384b : 0x3b2a2f, roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: ally ? 0x35c8ff : 0xff4a3c, emissiveIntensity: 2.6 });
  const g = new THREE.Group();
  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  add(g, GEO.leg, body, -0.14, 0.425, 0); add(g, GEO.leg, body, 0.14, 0.425, 0);
  add(g, GEO.torso, body, 0, 1.17, 0);
  add(g, GEO.stripe, glow, 0, 1.3, 0);
  add(g, GEO.head, body, 0, 1.64, 0);
  add(g, GEO.visor, glow, 0, 1.66, -0.12); // 顔は -Z 向き (yaw=0 で北を向く)
  // 銃を構えた腕。上下の向き (pitch) で回す
  const aim = new THREE.Group();
  aim.position.set(0, 1.38, 0);
  add(aim, GEO.arm, body, -0.3, -0.02, -0.22).rotation.x = -1.2;
  add(aim, GEO.arm, body, 0.3, -0.02, -0.22).rotation.x = -1.2;
  add(aim, GEO.gun, GUN_MAT, 0.12, 0, -0.55);
  g.add(aim);
  if (ally) g.add(nameTag(r.name));
  return { g, aim, body, materials: [body, glow], flash: 0, shown: 0 };
}

export class PlayerViews {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map();
  }

  onHit(id) { const v = this.views.get(id); if (v) v.flash = 1; }

  /** 表示用の状態 (session.remotes) に合わせて作成・更新・削除する */
  sync(remotes, myTeam, dt) {
    for (const v of this.views.values()) v.seen = false;
    for (const r of remotes) {
      let v = this.views.get(r.id);
      if (!v) {
        v = build(r, !!myTeam && r.team === myTeam);
        this.views.set(r.id, v);
        this.scene.add(v.g);
      }
      v.seen = true;
      // 出現と消滅は一瞬で伸び縮みさせる
      v.shown += ((r.alive ? 1 : 0) - v.shown) * (1 - Math.exp(-dt * 22));
      v.g.visible = v.shown > 0.03;
      if (!v.g.visible) continue;
      v.g.position.set(r.x, r.y, r.z);
      v.g.rotation.y = r.yaw;
      v.g.scale.set(1, v.shown * (1 - r.crouch * (1 - CROUCH_SCALE)), 1);
      v.aim.rotation.x = r.pitch;
      v.flash = Math.max(0, v.flash - dt * 9);
      v.body.emissiveIntensity = v.flash * 0.9;
    }
    for (const [id, v] of this.views) {
      if (v.seen) continue;
      this.scene.remove(v.g);
      for (const m of v.materials) m.dispose();
      this.views.delete(id);
    }
  }
}
