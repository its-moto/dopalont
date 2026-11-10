// 効果音のレシピ集。すべて AudioEngine の部品で合成する (DESIGN.md §9, §9.1)

const GUNS = {
  rifle: {
    crack: { f: 2600, dur: 0.05, gain: 0.9 },
    body: { f0: 190, f1: 46, dur: 0.12, gain: 1.0 },
    sub: { f0: 96, f1: 40, dur: 0.17, gain: 0.5 },
    mid: { f: 1100, q: 0.7, dur: 0.17, gain: 0.6 },
    tail: { f: 900, f1: 240, dur: 0.55, gain: 0.26 },
  },
  pistol: {
    crack: { f: 3600, dur: 0.03, gain: 0.6 },
    body: { f0: 270, f1: 72, dur: 0.075, gain: 0.72 },
    sub: null,
    mid: { f: 1900, q: 1.0, dur: 0.09, gain: 0.46 },
    tail: { f: 1300, f1: 420, dur: 0.28, gain: 0.13 },
  },
};

Object.assign(GUNS, {
  smg: {
    crack: { f: 3200, dur: 0.03, gain: 0.6 }, body: { f0: 230, f1: 70, dur: 0.06, gain: 0.7 }, sub: null,
    mid: { f: 1500, q: 0.9, dur: 0.08, gain: 0.5 }, tail: { f: 1100, f1: 380, dur: 0.22, gain: 0.12 },
  },
  shotgun: {
    crack: { f: 1800, dur: 0.07, gain: 1.0 }, body: { f0: 150, f1: 38, dur: 0.18, gain: 1.0 }, sub: { f0: 80, f1: 32, dur: 0.25, gain: 0.7 },
    mid: { f: 800, q: 0.5, dur: 0.22, gain: 0.8 }, tail: { f: 700, f1: 180, dur: 0.7, gain: 0.32 },
  },
  sniper: {
    crack: { f: 2200, dur: 0.07, gain: 1.0 }, body: { f0: 170, f1: 36, dur: 0.2, gain: 1.0 }, sub: { f0: 70, f1: 30, dur: 0.3, gain: 0.7 },
    mid: { f: 1000, q: 0.6, dur: 0.2, gain: 0.7 }, tail: { f: 800, f1: 160, dur: 1.0, gain: 0.36 },
  },
  mg: {
    crack: { f: 2300, dur: 0.05, gain: 0.9 }, body: { f0: 170, f1: 42, dur: 0.13, gain: 1.0 }, sub: { f0: 85, f1: 36, dur: 0.18, gain: 0.6 },
    mid: { f: 950, q: 0.7, dur: 0.17, gain: 0.65 }, tail: { f: 800, f1: 220, dur: 0.5, gain: 0.26 },
  },
  heavyPistol: {
    crack: { f: 2800, dur: 0.05, gain: 0.85 }, body: { f0: 210, f1: 50, dur: 0.13, gain: 0.95 }, sub: { f0: 90, f1: 40, dur: 0.16, gain: 0.4 },
    mid: { f: 1300, q: 0.8, dur: 0.14, gain: 0.6 }, tail: { f: 1000, f1: 260, dur: 0.5, gain: 0.24 },
  },
  silenced: {
    crack: { f: 4200, dur: 0.02, gain: 0.25 }, body: { f0: 320, f1: 140, dur: 0.05, gain: 0.35 }, sub: null,
    mid: { f: 2400, q: 1.4, dur: 0.06, gain: 0.3 }, tail: { f: 1600, f1: 700, dur: 0.1, gain: 0.04 },
  },
});

const STEPS = {
  sand: { f: 650, q: 0.6, dur: 0.1, gain: 0.22 },
  concrete: { f: 1700, q: 1.2, dur: 0.055, gain: 0.2 },
  sandstone: { f: 1500, q: 1.1, dur: 0.06, gain: 0.2 },
  painted: { f: 1700, q: 1.2, dur: 0.055, gain: 0.2 },
  tile: { f: 2300, q: 1.6, dur: 0.045, gain: 0.2 },
  wood: { f: 900, q: 2.0, dur: 0.08, gain: 0.24, ring: 210 },
  metal: { f: 2600, q: 1.4, dur: 0.06, gain: 0.2, ring: 520 },
};

const SEMI = Math.pow(2, 1 / 12);
const BELLS = [2093, 2349, 2637, 3136, 3520, 4186];

export class Sfx {
  constructor(engine) {
    this.e = engine;
    this.stepSide = 1;
    this.reloadGain = null;
  }

  get ok() { return !!this.e.ctx; }

  // ---- 武器 ----
  /** at を渡すと、その位置から聞こえる (他プレイヤーの銃声) */
  gunshot(kind, at = null) {
    if (!this.ok) return;
    const e = this.e, t = e.now, r = GUNS[kind];
    const pv = 0.96 + Math.random() * 0.08; // 毎発わずかに変えて機械的に聞こえないように
    if (kind === 'knife') { // 空を切る音
      const d = at ? e.spatial(at, e.buses.weapon, 3) : e.buses.weapon;
      e.noise({ t, f: 900, f1: 3200, q: 1.2, dur: 0.16, gain: 0.28, attack: 0.03, dest: d });
      return;
    }
    const dest = at ? e.spatial(at, e.gunIn, 9) : e.gunIn;
    e.noise({ t, type: 'highpass', f: r.crack.f * pv, dur: r.crack.dur, gain: r.crack.gain, dest });
    e.tone({ t, f0: r.body.f0 * pv, f1: r.body.f1, dur: r.body.dur, gain: r.body.gain, dest });
    if (r.sub) e.tone({ t, type: 'triangle', f0: r.sub.f0, f1: r.sub.f1, dur: r.sub.dur, gain: r.sub.gain, dest });
    e.noise({ t, f: r.mid.f * pv, q: r.mid.q, dur: r.mid.dur, gain: r.mid.gain, dest });
    e.noise({ t: t + 0.01, type: 'lowpass', f: r.tail.f, f1: r.tail.f1, dur: r.tail.dur, gain: r.tail.gain, attack: 0.01, dest });
    e.tone({ t: t + 0.012, type: 'square', f0: 3100 * pv, dur: 0.012, gain: 0.05, dest: e.buses.weapon }); // 機関部のカチッ
  }

  dry() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    e.noise({ t, f: 3400, q: 3, dur: 0.02, gain: 0.3, dest: e.buses.weapon });
    e.tone({ t, type: 'square', f0: 1400, f1: 900, dur: 0.02, gain: 0.08, dest: e.buses.weapon });
  }

  click(t, f, gain, dest) {
    const e = this.e;
    e.noise({ t, f, q: 2.5, dur: 0.025, gain, dest });
    e.tone({ t, type: 'triangle', f0: f * 0.3, f1: f * 0.18, dur: 0.04, gain: gain * 0.6, dest });
  }

  reload(dur) {
    if (!this.ok) return;
    this.cancelReload();
    const e = this.e, t = e.now;
    const g = (this.reloadGain = e.ctx.createGain());
    g.connect(e.buses.weapon);
    this.click(t + dur * 0.2, 2400, 0.3, g);                 // マガジンを抜く
    e.noise({ t: t + dur * 0.22, f: 900, q: 0.8, dur: 0.12, gain: 0.08, dest: g });
    this.click(t + dur * 0.62, 1700, 0.38, g);                // 差し込む
    e.tone({ t: t + dur * 0.62, f0: 260, f1: 120, dur: 0.07, gain: 0.25, dest: g });
    this.click(t + dur * 0.84, 3200, 0.3, g);                 // ボルトを引く
    this.click(t + dur * 0.84 + 0.07, 2700, 0.34, g);
  }

  cancelReload() {
    if (this.reloadGain) { this.reloadGain.gain.value = 0; this.reloadGain = null; }
  }

  equip() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    e.noise({ t, f: 1200, f1: 3000, q: 0.8, dur: 0.12, gain: 0.1, attack: 0.04, dest: e.buses.weapon });
    this.click(t + 0.14, 2200, 0.22, e.buses.weapon);
  }

  /** 壁への着弾音 (位置つき) */
  impact(point, mat) {
    if (!this.ok) return;
    const e = this.e, t = e.now + 0.01;
    const dest = e.spatial(point, e.buses.world);
    if (mat === 'metal') {
      const f = 1500 + Math.random() * 1500;
      e.tone({ t, f0: f, f1: f * 0.94, dur: 0.18, gain: 0.3, dest });
      e.tone({ t, f0: f * 2.7, dur: 0.08, gain: 0.12, dest });
    }
    e.noise({ t, f: mat === 'sand' ? 800 : 2200, q: 0.8, dur: 0.06, gain: 0.5, dest });
    e.tone({ t, f0: 180, f1: 70, dur: 0.05, gain: 0.3, dest });
  }

  // ---- 移動 ----
  /** at を渡すと、その位置から聞こえる (他プレイヤーの足音) */
  footstep(mat, at = null) {
    if (!this.ok) return;
    const e = this.e, t = e.now, s = STEPS[mat] || STEPS.concrete;
    let pan;
    if (at) {
      pan = e.spatial(at, e.buses.step, 5);
    } else {
      pan = e.ctx.createStereoPanner();
      pan.pan.value = (this.stepSide = -this.stepSide) * 0.18;
      pan.connect(e.buses.step);
    }
    const pv = 0.9 + Math.random() * 0.2;
    e.tone({ t, f0: 115 * pv, f1: 52, dur: 0.07, gain: 0.3, dest: pan });
    e.noise({ t, f: s.f * pv, q: s.q, dur: s.dur, gain: s.gain, dest: pan });
    if (s.ring) e.tone({ t, type: 'triangle', f0: s.ring * pv, dur: 0.11, gain: 0.07, dest: pan });
  }

  jump() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    e.noise({ t, f: 500, f1: 1100, q: 0.7, dur: 0.1, gain: 0.1, attack: 0.03, dest: e.buses.step });
  }

  land(mat) {
    if (!this.ok) return;
    const e = this.e, t = e.now, s = STEPS[mat] || STEPS.concrete;
    e.tone({ t, f0: 130, f1: 42, dur: 0.14, gain: 0.5, dest: e.buses.step });
    e.noise({ t, f: s.f * 0.7, q: 0.8, dur: 0.11, gain: 0.3, dest: e.buses.step });
  }

  // ---- ラウンドとスパイク ----
  /** 設置されたスパイクの警告音 (位置つき)。爆発が近いほど高く鳴る */
  spikeBeep(at, urgent) {
    if (!this.ok) return;
    const e = this.e, t = e.now, dest = e.spatial(at, e.buses.world, 12);
    const f = urgent ? 1480 : 1100;
    e.tone({ t, type: 'square', f0: f, dur: 0.09, gain: 0.3, dest });
    e.tone({ t, f0: f * 2, dur: 0.06, gain: 0.15, dest });
  }

  /** 設置・解除の作業音 */
  spikeWork(at, defuse) {
    if (!this.ok) return;
    const e = this.e, t = e.now, dest = e.spatial(at, e.buses.world, 8);
    e.tone({ t, type: 'triangle', f0: defuse ? 620 : 420, f1: defuse ? 760 : 520, dur: 0.12, gain: 0.25, dest });
    e.noise({ t, f: 3000, q: 3, dur: 0.03, gain: 0.15, dest });
  }

  planted() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    for (let i = 0; i < 3; i++) e.tone({ t: t + i * 0.16, type: 'square', f0: 660, f1: 880, dur: 0.14, gain: 0.16, dest: e.uiIn });
  }

  explosion(at) {
    if (!this.ok) return;
    const e = this.e, t = e.now, dest = e.spatial(at, e.gunIn, 30);
    e.tone({ t, f0: 120, f1: 24, dur: 1.4, gain: 1.0, dest });
    e.tone({ t, type: 'triangle', f0: 60, f1: 20, dur: 1.8, gain: 0.8, dest });
    e.noise({ t, type: 'lowpass', f: 2400, f1: 120, dur: 2.2, gain: 0.9, attack: 0.01, dest });
    e.noise({ t, type: 'highpass', f: 1800, dur: 0.25, gain: 0.7, dest });
  }

  /** 戦闘開始の合図 */
  roundGo() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    e.tone({ t, type: 'sawtooth', f0: 220, f1: 440, dur: 0.5, hold: 0.3, gain: 0.12, dest: e.uiIn });
    e.tone({ t, type: 'square', f0: 330, f1: 660, dur: 0.5, hold: 0.3, gain: 0.07, dest: e.uiIn });
  }

  roundWin() {
    if (!this.ok) return;
    const t = this.e.now + 0.05;
    this.arp(t, [523, 659, 784, 1047], 0.09, 0.15);
    for (let i = 0; i < 6; i++) this.coin(t + 0.45 + i * 0.08, 0.07);
    this.sparkle(t + 0.4, 6, 0.06);
  }

  roundLose() {
    if (!this.ok) return;
    const e = this.e, t = e.now + 0.05;
    [392, 330, 262].forEach((f, i) => e.tone({ t: t + i * 0.18, type: 'square', f0: f, f1: f * 0.94, dur: 0.3, gain: 0.1, dest: e.uiIn }));
  }

  buy(price) {
    if (!this.ok) return;
    const t = this.e.now;
    this.coin(t, 0.1);
    if (price >= 2000) { this.coin(t + 0.09, 0.1); this.sparkle(t + 0.1, 3, 0.05); } // 高い買い物ほど豪華に
    if (price >= 4000) this.kyuin(t + 0.12, 1.3, 0.14);
  }

  deny() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    e.tone({ t, type: 'square', f0: 180, f1: 140, dur: 0.14, gain: 0.12, dest: e.uiIn });
  }

  /** 自分が撃たれた */
  hurt() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    e.tone({ t, f0: 150, f1: 55, dur: 0.16, gain: 0.55, dest: e.buses.world });
    e.noise({ t, f: 700, q: 0.7, dur: 0.09, gain: 0.35, dest: e.buses.world });
  }

  /** 自分がやられた: しょぼい下降音 */
  death() {
    if (!this.ok) return;
    const e = this.e, t = e.now;
    e.tone({ t, type: 'sawtooth', f0: 420, f1: 70, dur: 0.6, gain: 0.2, dest: e.uiIn });
    e.tone({ t: t + 0.05, type: 'square', f0: 210, f1: 50, dur: 0.6, gain: 0.12, dest: e.uiIn });
  }

  // ---- 命中 ----
  hit(part) {
    if (!this.ok) return;
    const e = this.e, t = e.now, dest = e.buses.ui;
    if (part === 'head') {
      e.tone({ t, f0: 1760, dur: 0.09, gain: 0.22, dest });
      e.tone({ t, f0: 2640, dur: 0.07, gain: 0.12, dest });
      e.noise({ t, type: 'highpass', f: 5000, dur: 0.02, gain: 0.2, dest });
    } else {
      const f = part === 'body' ? 900 : 640;
      e.tone({ t, type: 'triangle', f0: f, f1: f * 0.8, dur: 0.045, gain: 0.22, dest });
      e.noise({ t, f: 2800, q: 1.5, dur: 0.018, gain: 0.18, dest });
    }
  }

  // ---- ドパミン演出 ----
  /** 「キュイン」: デチューンした 2 本の波形を一気に駆け上がらせる */
  kyuin(t, pitch = 1, gain = 0.3) {
    const e = this.e, ctx = e.ctx, sweep = 0.12, dur = 0.3;
    const f0 = 210 * pitch, f1 = 2500 * pitch;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(f0 * 2, t);
    bp.frequency.exponentialRampToValueAtTime(f1 * 1.6, t + sweep);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.setValueAtTime(gain, t + sweep);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bp.connect(g).connect(e.uiIn);
    for (const [type, det] of [['sawtooth', -9], ['square', 11]]) {
      const o = ctx.createOscillator();
      o.type = type; o.detune.value = det;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
      o.frequency.exponentialRampToValueAtTime(f1 * 0.86, t + dur); // 頂点から少し落ちる「ン」
      o.connect(bp);
      o.start(t); o.stop(t + dur + 0.02);
    }
  }

  sparkle(t, count = 6, gain = 0.1) {
    const e = this.e;
    for (let i = 0; i < count; i++) {
      const f = BELLS[Math.floor(Math.random() * BELLS.length)];
      const tt = t + i * 0.045;
      e.tone({ t: tt, f0: f, dur: 0.28, gain, dest: e.uiIn });
      e.tone({ t: tt, f0: f * 2.01, dur: 0.14, gain: gain * 0.4, dest: e.uiIn });
    }
  }

  drumroll(t, dur = 0.5) {
    const e = this.e, n = Math.floor(dur / 0.034);
    for (let i = 0; i < n; i++) {
      e.noise({ t: t + i * 0.034, f: 1900, q: 0.8, dur: 0.035, gain: 0.08 + (i / n) * 0.16, dest: e.uiIn });
    }
    e.noise({ t: t + dur, type: 'highpass', f: 6000, dur: 0.4, gain: 0.2, dest: e.uiIn }); // シンバル
  }

  arp(t, notes, step = 0.07, gain = 0.14) {
    const e = this.e;
    notes.forEach((f, i) => {
      e.tone({ t: t + i * step, type: 'square', f0: f, dur: 0.16, gain, dest: e.uiIn });
      e.tone({ t: t + i * step, type: 'triangle', f0: f * 2, dur: 0.12, gain: gain * 0.6, dest: e.uiIn });
    });
  }

  coin(t, gain = 0.12) {
    const e = this.e;
    e.tone({ t, type: 'square', f0: 988, dur: 0.05, gain, dest: e.uiIn });
    e.tone({ t: t + 0.045, type: 'square', f0: 1319, dur: 0.2, gain, dest: e.uiIn });
  }

  /**
   * キル演出の音。streak: 連続キル数、headshot: ヘッドショットか、level: 'dopamine' | 'subtle'
   */
  kill({ streak, headshot, level }) {
    if (!this.ok) return;
    const t = this.e.now + 0.02;
    if (level === 'subtle') {
      this.kyuin(t, headshot ? 1.2 : 1, 0.14);
      return;
    }
    const pitch = Math.pow(SEMI, Math.min(streak - 1, 7) * 2); // 連続キルで全音ずつ上がる
    this.kyuin(t, pitch, 0.3);
    if (headshot) {
      this.kyuin(t + 0.14, pitch * 1.12, 0.3); // キュインキュイン
      this.sparkle(t + 0.1, 7, 0.09);
    }
    if (streak === 2) this.arp(t + 0.2, [784, 1047]);
    if (streak === 3 || streak === 4) {
      this.drumroll(t + 0.15, 0.42); // リーチ
      this.arp(t + 0.6, streak === 3 ? [784, 988, 1175] : [784, 988, 1175, 1568], 0.06);
    }
    if (streak === 5) this.ace(t + 0.25);
    if (streak > 5) { this.kyuin(t + 0.14, pitch * 1.26, 0.26); this.coin(t + 0.3); this.coin(t + 0.42); }
  }

  /** 大当たりファンファーレ */
  ace(t) {
    const e = this.e;
    this.drumroll(t, 0.35);
    const t1 = t + 0.38;
    this.arp(t1, [523, 659, 784, 1047, 1319, 1568], 0.075, 0.16);
    for (const f of [523, 659, 784, 1047]) {
      e.tone({ t: t1 + 0.5, type: 'square', f0: f, dur: 1.0, hold: 0.6, gain: 0.07, dest: e.uiIn });
      e.tone({ t: t1 + 0.5, type: 'sawtooth', f0: f * 2, dur: 0.9, hold: 0.5, gain: 0.03, detune: 8, dest: e.uiIn });
    }
    for (let i = 0; i < 4; i++) this.kyuin(t1 + 0.55 + i * 0.16, 1.5 + i * 0.12, 0.16);
    for (let i = 0; i < 12; i++) this.coin(t1 + 0.6 + i * 0.075, 0.07);
    this.sparkle(t1 + 0.5, 14, 0.07);
  }
}
