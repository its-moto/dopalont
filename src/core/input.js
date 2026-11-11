import { DEG, clamp } from './math.js';

const MAX_PITCH = 89 * DEG;
const SLOT_KEYS = { Digit1: 'primary', Digit2: 'sidearm', Digit3: 'melee' };
const ABILITY_KEYS = { KeyC: 'c', KeyQ: 'q', KeyE: 'e', KeyX: 'x' };

/** キーボードとマウス。Pointer Lock 中だけ入力を受け付ける */
export class Input {
  constructor(settings) {
    this.settings = settings;
    this.keys = new Set();
    this.edges = new Set(); // 押された瞬間。sim の tick が消費するまで保持
    this.buttons = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1;
    this.locked = false;
    this.onLockChange = null;
  }

  attach(el) {
    this.el = el;
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (!e.repeat) { this.keys.add(e.code); this.edges.add(e.code); }
      if (e.code !== 'Escape' && e.code !== 'F11' && e.code !== 'F12') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousedown', (e) => { if (this.locked) this.buttons |= 1 << e.button; });
    document.addEventListener('mouseup', (e) => { this.buttons &= ~(1 << e.button); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const k = (this.settings.sens * 0.07 * DEG) / this.zoom;
      this.yaw -= e.movementX * k;
      this.pitch = clamp(this.pitch - e.movementY * k, -MAX_PITCH, MAX_PITCH);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.clear();
      this.onLockChange?.(this.locked);
    });
    window.addEventListener('blur', () => this.clear());
  }

  clear() { this.keys.clear(); this.edges.clear(); this.buttons = 0; }

  async lock() {
    try { await this.el.requestPointerLock(); } catch { /* Esc 直後は失敗する。もう一度クリックしてもらう */ }
  }

  /** sim に渡す入力 1 tick 分 */
  sample() {
    const k = this.keys;
    let slot = null;
    for (const code in SLOT_KEYS) if (this.edges.has(code)) slot = SLOT_KEYS[code];
    let ab = null;
    for (const code in ABILITY_KEYS) if (this.edges.has(code)) ab = ABILITY_KEYS[code];
    return {
      mx: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      mz: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      jump: k.has('Space'),
      crouch: k.has('ControlLeft') || k.has('ControlRight'),
      walk: k.has('ShiftLeft') || k.has('ShiftRight'),
      fire: (this.buttons & 1) !== 0,
      alt: (this.buttons & 4) !== 0,
      reload: this.edges.has('KeyR'),
      use: k.has('KeyF'),
      slot,
      ab,
      yaw: this.yaw,
      pitch: this.pitch,
    };
  }

  consumeEdges() { this.edges.clear(); }
}
