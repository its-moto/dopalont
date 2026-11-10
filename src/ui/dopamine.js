import { retrigger } from './hud.js';

// キル時のパチスロ風演出 (DESIGN.md §9.1)。sim には一切影響しない

const $ = (id) => document.getElementById(id);
const COLORS = ['#33aaff', '#33aaff', '#44ff66', '#ff4444', '#ffcc33']; // 1〜4 連続。5 以上は虹
const CONFETTI = ['#ff3d3d', '#ffb13d', '#f5ff3d', '#3dff7a', '#3dc8ff', '#b13dff', '#ff3dc8'];
const STREAK_TIMEOUT = 5; // 射撃場では 5 秒キルがないと連続が切れる (対戦では死ぬまで続く)

export class Dopamine {
  /** timeout: この秒数キルがないと連続が切れる。Infinity なら reset() を呼ぶまで続く */
  constructor(sfx, settings, timeout = STREAK_TIMEOUT) {
    this.sfx = sfx;
    this.settings = settings;
    this.timeout = timeout;
    this.streak = 0;
    this.timer = 0;
    this.reelTimer = 0;
    this.el = { edge: $('edge'), box: $('dopa'), stamp: $('dopa-stamp'), reel: $('dopa-reel'), ace: $('dopa-ace'), confetti: $('confetti'), hud: $('hud') };
  }

  update(dt) {
    if (this.streak > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.streak = 0;
    }
  }

  reset() { this.streak = 0; }

  kill({ headshot }) {
    const level = this.settings.fx;
    this.streak++;
    this.timer = this.timeout;
    if (level === 'off') return;
    const n = this.streak;
    this.sfx.kill({ streak: n, headshot, level });

    const rainbow = n >= 5 && level === 'dopamine';
    const color = COLORS[Math.min(n, 4)];
    this.el.hud.style.setProperty('--dopa', color);
    this.el.stamp.textContent = headshot ? 'HEADSHOT' : '';
    this.spinReel(n);
    retrigger(this.el.box, 'show', ...(rainbow ? ['rainbow'] : []));
    if (level !== 'dopamine') return;

    retrigger(this.el.edge, rainbow ? 'rainbow' : 'flash');
    if (n === 5) {
      setTimeout(() => { retrigger(this.el.ace, 'show'); this.confetti(90); }, 600);
    } else if (n > 5) {
      this.confetti(20);
    }
  }

  /** コンボ数がスロットのドラムのように回って止まる */
  spinReel(final) {
    const reel = this.el.reel;
    clearInterval(this.reelTimer);
    let i = 0;
    reel.classList.add('spin');
    this.reelTimer = setInterval(() => {
      if (++i >= 6) {
        clearInterval(this.reelTimer);
        reel.classList.remove('spin');
        reel.textContent = final;
      } else {
        reel.textContent = Math.floor(Math.random() * 9) + 1;
      }
    }, 35);
  }

  confetti(count) {
    const box = this.el.confetti;
    for (let i = 0; i < count; i++) {
      const c = document.createElement('i');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = CONFETTI[i % CONFETTI.length];
      c.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
      c.style.animationDelay = `${Math.random() * 0.5}s`;
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      c.addEventListener('animationend', () => c.remove());
      box.appendChild(c);
    }
  }
}
