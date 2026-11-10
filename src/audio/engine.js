// Web Audio の土台。音声ファイルは使わず、すべてここの部品で合成する (DESIGN.md §9)

function distortionCurve(amount) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

/** 振幅を階段状に丸める。パチスロっぽいチープなざらつきを出す */
function crushCurve(levels) {
  const n = 4096, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * levels) / levels;
  }
  return c;
}

export class AudioEngine {
  constructor() { this.ctx = null; this.volume = 0.7; }

  /** ユーザー操作 (クリック) の中で呼ぶこと */
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
    this.master.connect(comp).connect(ctx.destination);

    // ノイズ (2 秒) を使い回す
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // リバーブ: 減衰するノイズをインパルス応答として使う (屋外の反響)
    const irLen = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const a = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        a[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const revOut = ctx.createGain();
    revOut.gain.value = 0.45;
    const revLp = ctx.createBiquadFilter();
    revLp.type = 'lowpass'; revLp.frequency.value = 3200;
    this.reverb.connect(revLp).connect(revOut).connect(this.master);

    const bus = (gain) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(this.master); return g; };
    this.buses = { weapon: bus(0.9), step: bus(0.8), world: bus(0.8), ui: bus(0.75) };

    // 銃声: 軽く歪ませて太くする
    this.gunIn = ctx.createGain();
    const drive = ctx.createWaveShaper();
    drive.curve = distortionCurve(2.4);
    this.gunIn.connect(drive).connect(this.buses.weapon);
    const gunSend = ctx.createGain();
    gunSend.gain.value = 0.35;
    this.gunIn.connect(gunSend).connect(this.reverb);

    // 演出音: 低域を切って足音の帯域を空け、ビットクラッシュ + 短いディレイを通す
    this.uiIn = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 260;
    const crush = ctx.createWaveShaper();
    crush.curve = crushCurve(14);
    this.uiIn.connect(crush).connect(hp).connect(this.buses.ui);
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.085;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    hp.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(this.buses.ui);
    // ディレイ時間を揺らしてフランジャー風に
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 3.1; lfoG.gain.value = 0.004;
    lfo.connect(lfoG).connect(delay.delayTime); lfo.start();
  }

  get now() { return this.ctx.currentTime; }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  setListener(pos, fwd) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** 位置つきの出力先を作る */
  spatial(point, dest) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4; p.rolloffFactor = 1.3; p.maxDistance = 200;
    p.positionX.value = point[0]; p.positionY.value = point[1]; p.positionZ.value = point[2];
    p.connect(dest);
    return p;
  }

  /** フィルタを通したノイズ。f1 を渡すとフィルタ周波数が動く */
  noise({ t, dur, type = 'bandpass', f, f1, q = 1, gain, attack = 0.001, dest }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  /** 音程のある音。f1 を渡すとピッチが動く */
  tone({ t, dur, type = 'sine', f0, f1, gain, attack = 0.002, dest, detune = 0, hold = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + (hold || dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (hold) g.gain.setValueAtTime(gain, t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }
}
