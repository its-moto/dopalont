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
  constructor() {
    this.ctx = null; this.volume = 0.7;
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.occluded = null; // (point) => 壁の向こうか。Game が設定する
  }

  /** ユーザー操作 (クリック) の中で呼ぶこと */
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    // 潰しすぎると遠くの小さな音まで持ち上がり、距離感がなくなる。ピークを抑える程度にとどめる
    comp.threshold.value = -8; comp.ratio.value = 3; comp.attack.value = 0.002; comp.release.value = 0.12;
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
    this.buses = { weapon: bus(0.9), step: bus(0.8), world: bus(0.8), ui: bus(0.75), amb: bus(0.5) };
    this.busBase = { weapon: 0.9, step: 0.8, world: 0.8, ui: 0.75, amb: 0.5 };
    for (const k in this.busScale) this.setBus(k, this.busScale[k]);

    // 銃声: 軽く歪ませて太くする
    this.gunIn = ctx.createGain();
    const drive = ctx.createWaveShaper();
    drive.curve = this.driveCurve = distortionCurve(2.4);
    this.gunIn.connect(drive).connect(this.buses.weapon);
    const gunSend = ctx.createGain();
    gunSend.gain.value = 0.35;
    this.gunIn.connect(gunSend).connect(this.reverb);
    this.gunRev = gunSend; // 位置つきの銃声のリバーブ送り

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

  /** 種類ごとの音量 (0〜1)。全体の音量とは別に掛かる */
  setBus(name, scale) {
    (this.busScale ??= {})[name] = scale;
    if (this.buses && this.buses[name]) this.buses[name].gain.setTargetAtTime(this.busBase[name] * scale, this.ctx.currentTime, 0.03);
  }

  /** 環境音 (風と遠くのうなり)。試合中ずっと小さく流す */
  ambient(on) {
    if (!this.ctx) return;
    if (!on) { this.amb?.stop(); this.amb = null; return; }
    if (this.amb) return;
    const ctx = this.ctx, nodes = [];
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf; wind.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.16;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); // 風の強弱
    lfo.frequency.value = 0.13; lg.gain.value = 0.09;
    lfo.connect(lg).connect(g.gain);
    const lfo2 = ctx.createOscillator(), lg2 = ctx.createGain(); // 音色のゆらぎ
    lfo2.frequency.value = 0.07; lg2.gain.value = 160;
    lfo2.connect(lg2).connect(lp.frequency);
    wind.connect(lp).connect(g).connect(this.buses.amb);
    const hum = ctx.createOscillator(), hg = ctx.createGain(); // 工場の低いうなり
    hum.type = 'sawtooth'; hum.frequency.value = 55; hg.gain.value = 0.012;
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 180;
    hum.connect(hl).connect(hg).connect(this.buses.amb);
    for (const n of [wind, lfo, lfo2, hum]) { n.start(); nodes.push(n); }
    this.amb = { stop: () => { for (const n of nodes) { try { n.stop(); } catch { /* 既に止まっている */ } } g.disconnect(); hg.disconnect(); } };
  }

  /** 屋根のある場所では銃声の反響を強める */
  setIndoor(indoor) {
    if (!this.ctx || this.indoor === indoor) return;
    this.indoor = indoor;
    this.gunRev.gain.setTargetAtTime(indoor ? 0.7 : 0.35, this.ctx.currentTime, 0.2);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  setListener(pos, fwd) {
    this.listenerPos.x = pos.x; this.listenerPos.y = pos.y; this.listenerPos.z = pos.z;
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
  /**
   * 位置つきの出力先を作る。返したノードに音をつなぐ
   * ref: この距離までは最大音量。max: この距離で聞こえなくなる
   * - 距離: max で完全に消える (以前の方式は遠くでも小さく鳴り続けた)
   * - 方向: HRTF で左右と前後がわかる
   * - 壁越し (occluded が true を返す時) と遠くの音は、高音を削って籠らせる
   */
  spatial(point, dest, ref = 4, max = ref * 8) {
    const ctx = this.ctx, L = this.listenerPos;
    const d = Math.hypot(point[0] - L.x, point[1] - L.y, point[2] - L.z);
    const far = Math.min(1, Math.max(0, (d - ref) / (max - ref)));
    const occ = this.occluded ? this.occluded(point) : false;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'linear';
    p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1;
    p.positionX.value = point[0]; p.positionY.value = point[1]; p.positionZ.value = point[2];
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (occ ? 1200 : 16000) * (1 - far * 0.85);
    const g = ctx.createGain();
    g.gain.value = (occ ? 0.45 : 1) * (1 - far * 0.6); // linear の減衰にさらに掛けて、遠くほど急に小さく
    p.connect(lp).connect(g).connect(dest);
    p.tail = g; // 減衰後の出口 (リバーブへ送る時に使う)
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
