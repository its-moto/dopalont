import { loadSettings, saveSettings } from './core/settings.js';
import { Input } from './core/input.js';
import { AudioEngine } from './audio/engine.js';
import { Sfx } from './audio/sfx.js';
import { createMaterials } from './render/textures.js';
import { FOUNDRY } from './data/maps/foundry.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const audio = new AudioEngine();
audio.volume = settings.volume;
const sfx = new Sfx(audio);
const input = new Input(settings);
const canvas = $('view');
input.attach(canvas);

let game = null;

// ---- タイトル ----
$('name').value = settings.name;
$('btn-range').addEventListener('click', async () => {
  settings.name = $('name').value.trim();
  saveSettings(settings);
  audio.init(); // 音はクリックの中で開始する必要がある
  $('title').hidden = true;
  $('loading').hidden = false;
  await new Promise((r) => setTimeout(r, 30)); // 読み込み画面を先に描かせる

  const materials = await createMaterials((ratio) => { $('loading-bar').style.width = `${ratio * 100}%`; });
  game = new Game({ canvas, mapDef: FOUNDRY, materials, input, sfx, audio, settings });
  window.__game = game; // デバッグ用
  game.start();
  $('loading').hidden = true;
  $('pause').hidden = false;
  input.lock();
});

// ---- 一時停止 / 設定 ----
input.onLockChange = (locked) => { if (game) $('pause').hidden = locked; };
$('btn-resume').addEventListener('click', () => { audio.init(); input.lock(); });

const bind = (id, outId, key, fmt, apply) => {
  const el = $(id), out = outId && $(outId);
  el.value = settings[key];
  if (out) out.textContent = fmt(settings[key]);
  el.addEventListener('input', () => {
    settings[key] = el.type === 'range' ? Number(el.value) : el.value;
    if (out) out.textContent = fmt(settings[key]);
    apply?.(settings[key]);
    saveSettings(settings);
  });
};
bind('sens', 'sens-out', 'sens', (v) => v.toFixed(2));
bind('vol', 'vol-out', 'volume', (v) => `${Math.round(v * 100)}%`, (v) => audio.setVolume(v));
bind('fx', null, 'fx');

$('btn-fullscreen').addEventListener('click', async () => {
  try {
    await document.documentElement.requestFullscreen();
    await navigator.keyboard?.lock?.(); // フルスクリーン中は Ctrl+W などをゲームが受け取れる
  } catch { /* 対応していないブラウザでは何もしない */ }
});

// しゃがみ (Ctrl) + 前進 (W) でタブが閉じる事故を防ぐ
window.addEventListener('beforeunload', (e) => { if (game && input.locked) e.preventDefault(); });
