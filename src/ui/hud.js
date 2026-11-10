import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

/** CSS アニメーションを最初からやり直す */
export function retrigger(el, ...classes) {
  el.classList.remove('show', 'flash', 'rainbow', 'head', 'kill', ...classes);
  void el.offsetWidth;
  el.classList.add(...classes);
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      hp: $('hp'), armor: $('armor'), name: $('weapon-name'), ammo: $('ammo'), mag: $('ammo-mag'), res: $('ammo-res'),
      reload: $('reload-bar'), reloadFill: $('reload-bar').firstElementChild,
      hit: $('hitmarker'), dmg: $('dmg-layer'), crosshair: $('crosshair'),
      kills: $('st-kills'), hs: $('st-hs'), acc: $('st-acc'), fps: $('st-fps'),
    };
    this.cache = {};
    this.fpsT = 0; this.fpsN = 0;
  }

  show(on) { this.root.hidden = !on; }

  set(key, el, value) {
    if (this.cache[key] === value) return; // 変わった時だけ DOM を触る
    this.cache[key] = value;
    el.textContent = value;
  }

  update(dt, p, world, stats) {
    const w = p.weapons[p.slot], e = this.el;
    this.set('hp', e.hp, Math.max(0, Math.ceil(p.hp)));
    this.set('armor', e.armor, p.armor);
    this.set('name', e.name, w.def.name);
    this.set('mag', e.mag, w.ammo);
    this.set('res', e.res, world.infiniteReserve ? '∞' : w.reserve);
    e.ammo.classList.toggle('low', w.ammo <= Math.ceil(w.def.magSize * 0.25));
    const reloading = w.reloadEnd > 0;
    e.reload.classList.toggle('on', reloading);
    if (reloading) e.reloadFill.style.width = `${(1 - (w.reloadEnd - world.time) / w.def.reloadTime) * 100}%`;
    e.crosshair.style.opacity = p.ads ? 0.55 : 1;

    this.set('kills', e.kills, stats.kills);
    this.set('hs', e.hs, stats.kills ? `${Math.round((stats.hs / stats.kills) * 100)}%` : '-');
    this.set('acc', e.acc, stats.shots ? `${Math.round((stats.hits / stats.shots) * 100)}%` : '-');
    this.fpsT += dt; this.fpsN++;
    if (this.fpsT >= 0.5) { this.set('fps', e.fps, Math.round(this.fpsN / this.fpsT)); this.fpsT = 0; this.fpsN = 0; }
  }

  hitmarker(part, killed) {
    retrigger(this.el.hit, 'show', ...(killed ? ['kill'] : part === 'head' ? ['head'] : []));
  }

  /** 命中した場所にダメージ数値を浮かべる */
  damageNumber(point, damage, part, camera) {
    _v.set(point[0], point[1] + 0.25, point[2]).project(camera);
    if (_v.z > 1) return;
    const d = document.createElement('div');
    d.className = part === 'head' ? 'dmg head' : 'dmg';
    d.textContent = damage;
    d.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
    d.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
    d.addEventListener('animationend', () => d.remove());
    this.el.dmg.appendChild(d);
  }
}
