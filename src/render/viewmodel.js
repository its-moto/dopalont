import * as THREE from 'three';
import { canvasTexture } from './textures.js';

// 一人称の手と武器。壁にめり込まないよう、別シーンを本編の上に重ねて描く

const M = {
  gun: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.45, metalness: 0.7 }),
  gun2: new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.4 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3d7f, emissiveIntensity: 2.2, roughness: 0.4 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.9 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x2c4a63, roughness: 0.85 }),
};

const MODEL_SCALE = 0.6; // 画面を占めすぎないように全体を縮める

function box(parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function buildRifle() {
  const g = new THREE.Group();
  box(g, M.gun, 0.05, 0.08, 0.34, 0, 0.03, -0.1);
  box(g, M.gun2, 0.046, 0.056, 0.22, 0, 0.035, -0.36);
  box(g, M.accent, 0.052, 0.01, 0.2, 0, 0.046, -0.35);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 8), M.gun);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.04, -0.55);
  g.add(barrel);
  box(g, M.gun, 0.03, 0.03, 0.055, 0, 0.04, -0.66);
  const mag = box(g, M.gun2, 0.034, 0.16, 0.07, 0, -0.08, -0.13, 0.22);
  box(g, M.gun2, 0.034, 0.1, 0.045, 0, -0.05, 0.04, -0.3);
  box(g, M.gun2, 0.04, 0.07, 0.2, 0, 0.02, 0.19);
  box(g, M.gun, 0.02, 0.03, 0.03, 0, 0.085, 0);
  box(g, M.gun, 0.008, 0.035, 0.01, 0, 0.085, -0.44);
  // 手と腕
  box(g, M.glove, 0.06, 0.075, 0.085, 0.005, -0.05, 0.045);
  box(g, M.sleeve, 0.075, 0.075, 0.34, 0.07, -0.13, 0.22, 0.35, -0.35);
  box(g, M.glove, 0.07, 0.06, 0.09, -0.005, -0.005, -0.34);
  box(g, M.sleeve, 0.07, 0.07, 0.36, -0.12, -0.13, -0.2, 0.6, 0.75);
  return { group: g, mag, magRest: mag.position.clone(), muzzle: new THREE.Vector3(0, 0.04, -0.7),
    base: new THREE.Vector3(0.16, -0.165, -0.42), ads: new THREE.Vector3(0, -0.066, -0.3) };
}

function buildPistol() {
  const g = new THREE.Group();
  box(g, M.gun, 0.032, 0.045, 0.19, 0, 0.03, -0.07);
  box(g, M.gun2, 0.03, 0.03, 0.15, 0, -0.005, -0.06);
  box(g, M.accent, 0.034, 0.008, 0.08, 0, 0.012, -0.1);
  const mag = box(g, M.gun2, 0.03, 0.1, 0.045, 0, -0.06, 0.012, -0.2);
  box(g, M.gun, 0.008, 0.012, 0.01, 0, 0.058, -0.155);
  box(g, M.gun, 0.02, 0.012, 0.012, 0, 0.058, 0.015);
  box(g, M.glove, 0.06, 0.09, 0.08, 0.004, -0.06, 0.02);
  box(g, M.sleeve, 0.075, 0.075, 0.34, 0.06, -0.14, 0.2, 0.35, -0.3);
  box(g, M.glove, 0.06, 0.07, 0.07, -0.03, -0.075, 0.01);
  box(g, M.sleeve, 0.075, 0.075, 0.34, -0.14, -0.15, 0.17, 0.3, 0.6);
  return { group: g, mag, magRest: mag.position.clone(), muzzle: new THREE.Vector3(0, 0.03, -0.18),
    base: new THREE.Vector3(0.12, -0.14, -0.42), ads: new THREE.Vector3(0.12, -0.14, -0.42) };
}

function buildKnife() {
  const g = new THREE.Group();
  const blade = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, roughness: 0.25, metalness: 0.9 });
  box(g, blade, 0.008, 0.045, 0.24, 0, 0.03, -0.2);
  box(g, M.accent, 0.012, 0.008, 0.2, 0, 0.012, -0.2);
  box(g, M.gun, 0.03, 0.02, 0.02, 0, 0.03, -0.07);
  const mag = box(g, M.gun2, 0.028, 0.035, 0.12, 0, 0.03, 0);
  box(g, M.glove, 0.06, 0.08, 0.09, 0.004, 0.0, 0.01);
  box(g, M.sleeve, 0.075, 0.075, 0.34, 0.06, -0.08, 0.2, 0.35, -0.3);
  return { group: g, mag, magRest: mag.position.clone(), muzzle: new THREE.Vector3(0, 0.03, -0.3),
    base: new THREE.Vector3(0.16, -0.16, -0.36), ads: new THREE.Vector3(0.16, -0.16, -0.36), melee: true };
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xdde8ff, 0x8a7458, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
    sun.position.set(-1, 2, 1.5);
    this.scene.add(sun);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.models = { rifle: buildRifle(), pistol: buildPistol(), knife: buildKnife() };
    for (const k in this.models) { this.models[k].group.scale.setScalar(MODEL_SCALE); this.models[k].group.visible = false; this.root.add(this.models[k].group); }

    const flashTex = canvasTexture(128, (ctx, s) => {
      const c = s / 2;
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, 'rgba(255,255,235,1)');
      grad.addColorStop(0.25, 'rgba(255,200,90,0.9)');
      grad.addColorStop(1, 'rgba(255,90,0,0)');
      ctx.fillStyle = grad;
      ctx.translate(c, c);
      for (let i = 0; i < 5; i++) { // 星形の炎
        ctx.rotate((Math.PI * 2) / 5);
        ctx.beginPath(); ctx.moveTo(0, -c); ctx.lineTo(c * 0.2, 0); ctx.lineTo(-c * 0.2, 0); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, c * 0.4, 0, Math.PI * 2); ctx.fill();
    });
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    );
    this.flash.visible = false;
    this.root.add(this.flash);

    this.cur = null;
    this.kick = 0; this.kickRot = 0;
    this.bobPhase = 0; this.bobAmt = 0;
    this.swayX = 0; this.swayY = 0;
    this.adsT = 0;
    this.reloadT = -1; this.reloadDur = 1;
    this.equipT = 1; this.equipDur = 1;
    this.flashT = 0;
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  setWeapon(def, equipDur = 0) {
    if (this.cur) this.cur.group.visible = false;
    this.cur = this.models[def.model];
    this.cur.group.visible = true;
    this.cur.mag.position.copy(this.cur.magRest);
    this.reloadT = -1;
    this.kick = 0; this.kickRot = 0;
    if (equipDur > 0) { this.equipT = 0; this.equipDur = equipDur; }
  }

  onShot(def) {
    if (def.melee) { this.kick -= 0.16; this.kickRot -= 0.5; return; } // 突き出す。火花は出ない
    this.kick += 0.035 * def.kick;
    this.kickRot += 0.05 * def.kick;
    this.flashT = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.6);
  }

  onReload(dur) { this.reloadT = 0; this.reloadDur = dur; }
  cancelReload() { this.reloadT = -1; if (this.cur) this.cur.mag.position.copy(this.cur.magRest); }

  /** @param s {{speed:number, onGround:boolean, ads:boolean, dyaw:number, dpitch:number}} */
  update(dt, s) {
    const m = this.cur;
    if (!m) return;
    const g = m.group;

    this.kick *= Math.exp(-dt * 16); this.kickRot *= Math.exp(-dt * 14);
    this.adsT += ((s.ads ? 1 : 0) - this.adsT) * (1 - Math.exp(-dt * 16));

    const moving = s.onGround ? Math.min(1, s.speed / 6.75) : 0;
    this.bobAmt += (moving - this.bobAmt) * (1 - Math.exp(-dt * 8));
    this.bobPhase += dt * (4 + s.speed * 1.5);
    const bob = this.bobAmt * (1 - this.adsT * 0.8);
    const bx = Math.sin(this.bobPhase) * 0.008 * bob, by = -Math.abs(Math.cos(this.bobPhase)) * 0.007 * bob;

    // 視点を振ると武器が少し遅れてついてくる
    const k = 1 - Math.exp(-dt * 10);
    this.swayX += (Math.max(-0.03, Math.min(0.03, s.dyaw * 0.6)) - this.swayX) * k;
    this.swayY += (Math.max(-0.03, Math.min(0.03, s.dpitch * 0.6)) - this.swayY) * k;

    g.position.lerpVectors(m.base, m.ads, this.adsT);
    g.position.x += bx + this.swayX;
    g.position.y += by - this.swayY;
    g.position.z += this.kick;
    g.rotation.set(this.kickRot, this.swayX * 1.5, 0);

    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      const t = Math.min(1, this.reloadT);
      const dip = Math.sin(Math.PI * Math.min(1, t * 1.1));
      g.position.y -= 0.07 * dip;
      g.rotation.x += 0.45 * dip;
      g.rotation.z += 0.5 * dip;
      // マガジンを抜いて、差し直す
      const out = t < 0.2 ? 0 : t < 0.45 ? (t - 0.2) / 0.25 : t < 0.6 ? 1 : t < 0.8 ? 1 - (t - 0.6) / 0.2 : 0;
      m.mag.position.copy(m.magRest);
      m.mag.position.y -= out * 0.22;
      if (this.reloadT >= 1) this.reloadT = -1;
    }
    if (this.equipT < 1) {
      this.equipT = Math.min(1, this.equipT + dt / this.equipDur);
      const e = 1 - this.equipT, ee = e * e;
      g.position.y -= ee * 0.3;
      g.rotation.x -= ee * 0.9;
    }

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) {
      this.flash.position.copy(m.muzzle).multiplyScalar(MODEL_SCALE).applyEuler(g.rotation).add(g.position);
    }
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
