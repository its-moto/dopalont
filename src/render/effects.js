import * as THREE from 'three';
import { canvasTexture } from './textures.js';

// 弾痕・トレーサー・着弾の粉塵と火花・マズルの光。毎フレーム new しないよう全部プールする

const MAX_DECALS = 160, MAX_TRACERS = 12, MAX_PARTICLES = 700;
const DUST = { brick: [0.6, 0.3, 0.22], plaster: [0.8, 0.77, 0.68], tarp: [0.3, 0.38, 0.26], sandbag: [0.7, 0.6, 0.44], planks: [0.5, 0.36, 0.22], asphalt: [0.3, 0.3, 0.32], metal2: [0.4, 0.34, 0.2], sand: [0.78, 0.66, 0.48], sandstone: [0.8, 0.66, 0.46], concrete: [0.62, 0.61, 0.58], painted: [0.7, 0.68, 0.62], tile: [0.6, 0.62, 0.64], wood: [0.5, 0.35, 0.2], metal: [0.35, 0.33, 0.3] };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1), _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    // 弾痕
    const holeTex = canvasTexture(64, (ctx, s) => {
      const c = s / 2, g = ctx.createRadialGradient(c, c, 0, c, c, c);
      g.addColorStop(0, 'rgba(5,5,5,1)'); g.addColorStop(0.3, 'rgba(20,18,16,0.95)');
      g.addColorStop(0.55, 'rgba(40,36,32,0.45)'); g.addColorStop(1, 'rgba(60,55,50,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(10,10,10,0.6)'; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) { // ひび
        const a = (i / 7) * Math.PI * 2 + i * 0.5;
        ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * 6, c + Math.sin(a) * 6);
        ctx.lineTo(c + Math.cos(a + 0.2) * (14 + (i * 5) % 12), c + Math.sin(a + 0.2) * (14 + (i * 5) % 12)); ctx.stroke();
      }
    });
    this.decals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      MAX_DECALS,
    );
    this.decals.frustumCulled = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, _m);
    this.decalIdx = 0;
    scene.add(this.decals);

    // トレーサー
    this.tracers = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      mesh.visible = false; mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this.tracerIdx = 0;

    // パーティクル
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 4);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    this.pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */`
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - d * d));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pIdx = 0;

    this.light = new THREE.PointLight(0xffb060, 0, 14, 2);
    scene.add(this.light);
    this.lightT = 0;
  }

  setViewport(height, fovDeg) {
    this.pMat.uniforms.scale.value = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  decal(point, normal) {
    _n.set(normal[0], normal[1], normal[2]);
    _q.setFromUnitVectors(_z, _n);
    _q.multiply(new THREE.Quaternion().setFromAxisAngle(_z, Math.random() * 6.28));
    const size = 0.1 + Math.random() * 0.05;
    _s.set(size, size, size);
    _p.set(point[0], point[1], point[2]).addScaledVector(_n, 0.004);
    _m.compose(_p, _q, _s);
    this.decals.setMatrixAt(this.decalIdx, _m);
    this.decalIdx = (this.decalIdx + 1) % MAX_DECALS;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  tracer(from, to) {
    _a.copy(from); _b.set(to[0], to[1], to[2]);
    const len = _a.distanceTo(_b);
    if (len < 1.5) return;
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    t.mesh.position.lerpVectors(_a, _b, 0.5);
    t.mesh.lookAt(_b);
    t.mesh.scale.set(0.014, 0.014, len);
    t.mesh.material.opacity = 0.55;
    t.mesh.visible = true;
    t.life = 0.07;
  }

  particle(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav) {
    const i = this.pIdx;
    this.pIdx = (i + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pCol[i * 4] = r; this.pCol[i * 4 + 1] = g; this.pCol[i * 4 + 2] = b; this.pCol[i * 4 + 3] = a;
    this.pSize[i] = size; this.pLife[i] = life; this.pMax[i] = life; this.pGrav[i] = grav;
  }

  /** 壁への着弾: 弾痕 + 粉塵 (金属は火花) */
  impact(point, normal, mat) {
    this.decal(point, normal);
    const [x, y, z] = point, [nx, ny, nz] = normal;
    const c = DUST[mat] || DUST.concrete;
    const rnd = () => Math.random() - 0.5;
    for (let i = 0; i < 7; i++) {
      const sp = 0.6 + Math.random() * 1.6;
      this.particle(x, y, z, nx * sp + rnd() * 1.2, ny * sp + rnd() * 1.2 + 0.4, nz * sp + rnd() * 1.2,
        c[0], c[1], c[2], 0.55, 0.1 + Math.random() * 0.14, 0.35 + Math.random() * 0.35, 1.5);
    }
    const sparks = mat === 'metal' || mat === 'metal2' ? 8 : 2;
    for (let i = 0; i < sparks; i++) {
      const sp = 3 + Math.random() * 5;
      this.particle(x, y, z, nx * sp + rnd() * 4, ny * sp + rnd() * 4, nz * sp + rnd() * 4,
        3, 1.8, 0.6, 1, 0.025, 0.12 + Math.random() * 0.15, 9);
    }
  }

  /** 的への命中: 光の粒が弾ける */
  hitSpark(point, head) {
    const [x, y, z] = point;
    const rnd = () => Math.random() - 0.5;
    for (let i = 0; i < (head ? 16 : 8); i++) {
      this.particle(x, y, z, rnd() * 6, rnd() * 6 + 1, rnd() * 6,
        head ? 3 : 2.4, head ? 2.4 : 0.5, head ? 0.6 : 0.9, 1, 0.035, 0.18 + Math.random() * 0.15, 6);
    }
  }

  muzzleLight(pos) {
    this.light.position.copy(pos);
    this.light.intensity = 26;
    this.lightT = 0.05;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.55;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pSize[i] = 0; continue; }
      const k = i * 3;
      this.pVel[k + 1] -= this.pGrav[i] * dt;
      this.pPos[k] += this.pVel[k] * dt; this.pPos[k + 1] += this.pVel[k + 1] * dt; this.pPos[k + 2] += this.pVel[k + 2] * dt;
      const drag = Math.exp(-dt * 3);
      this.pVel[k] *= drag; this.pVel[k + 2] *= drag;
      this.pCol[i * 4 + 3] = Math.min(1, (this.pLife[i] / this.pMax[i]) * 1.5) * 0.8;
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true; g.color.needsUpdate = true; g.size.needsUpdate = true;

    if (this.lightT > 0) {
      this.lightT -= dt;
      if (this.lightT <= 0) this.light.intensity = 0;
    }
  }
}
