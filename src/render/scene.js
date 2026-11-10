import * as THREE from 'three';

export const BASE_FOV = 71; // 縦 FOV。16:9 で横およそ 103 度

export function createRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.autoClear = false; // ビューモデルを重ね描きするため、自分で clear する
  return r;
}

const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.42).normalize();
const HAZE = 0xd8c3a0;

function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 zenith = vec3(0.16, 0.36, 0.72), horizon = vec3(0.86, 0.74, 0.58);
        vec3 col = mix(horizon, zenith, pow(h, 0.45));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.8, 0.5) * (pow(s, 6.0) * 0.25 + pow(s, 900.0) * 6.0);
        if (d.y < 0.0) col = horizon * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), mat);
  sky.frustumCulled = false;
  return sky;
}

export function createScene(mapSize) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HAZE, 50, 320);
  scene.add(createSky());

  const sun = new THREE.DirectionalLight(0xfff0d6, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(150);
  sun.castShadow = true;
  const half = Math.max(mapSize[0], mapSize[1]) / 2 + 12;
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 20; sc.far = 320;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x9a7a52, 1.15));

  const camera = new THREE.PerspectiveCamera(BASE_FOV, 16 / 9, 0.05, 900);
  camera.rotation.order = 'YXZ';
  return { scene, camera, sun };
}
