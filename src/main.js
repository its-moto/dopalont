import { loadSettings, saveSettings } from './core/settings.js';
import { Input } from './core/input.js';
import { AudioEngine } from './audio/engine.js';
import { Sfx } from './audio/sfx.js';
import { createRenderer } from './render/scene.js';
import { createMaterials } from './render/textures.js';
import { FOUNDRY } from './data/maps/foundry.js';
import { LocalSession } from './net/local.js';
import { HostRoom } from './net/host.js';
import { ClientRoom } from './net/client.js';
import { normalizeCode } from './net/peer.js';
import { NET } from './net/config.js';
import { LobbyUI } from './ui/lobby.js';
import { BuyMenu } from './ui/buymenu.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['title', 'lobby', 'loading', 'pause'];
const settings = loadSettings();
const audio = new AudioEngine();
audio.volume = settings.volume;
const sfx = new Sfx(audio);
const input = new Input(settings);
const canvas = $('view');
input.attach(canvas);

const buyMenu = new BuyMenu();
let game = null;     // 進行中の試合 (表示側)
let room = null;     // 接続中の部屋 (HostRoom か ClientRoom)
let gfx = null;      // レンダラーと素材。最初の試合で 1 回だけ作る

/** 画面を 1 つだけ出す。設定パネルもその画面へ移す */
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  const slot = name && $(name).querySelector('.settings-slot');
  if (slot) slot.append($('settings-box'));
}

const playerName = () => {
  settings.name = $('name').value.trim().slice(0, 16);
  saveSettings(settings);
  return settings.name || 'プレイヤー';
};
const titleMsg = (text) => { $('title-msg').textContent = text; };

async function ensureGfx() {
  if (gfx) return gfx;
  show('loading');
  await new Promise((r) => setTimeout(r, 30)); // 読み込み画面を先に描かせる
  const materials = await createMaterials((ratio) => { $('loading-bar').style.width = `${ratio * 100}%`; });
  return (gfx = { renderer: createRenderer(canvas), materials });
}

async function startGame(makeSession) {
  const { renderer, materials } = await ensureGfx();
  game?.dispose();
  const session = makeSession();
  game = new Game({ renderer, materials, session, input, sfx, audio, settings, buyMenu, hooks: { onUnlocked: () => show('pause') } });
  window.__game = game; // デバッグ用
  game.start();
  lobbyUI.close();
  $('btn-end').hidden = !(room && room.isHost);
  show('pause');
  input.lock();
}

function stopGame() {
  if (document.pointerLockElement) document.exitPointerLock();
  game?.dispose();
  game = null;
}

function toLobby() {
  stopGame();
  show('lobby');
  lobbyUI.open(room);
}

function toTitle(message = '') {
  stopGame();
  room?.close();
  room = null;
  lobbyUI.close();
  show('title');
  titleMsg(message);
}

const lobbyUI = new LobbyUI({
  onStart: () => startGame(() => room.startGame(FOUNDRY)),
  onLeave: () => toTitle(),
});

// ---- タイトル ----
$('name').value = settings.name;
$('join-code').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });

async function connect(make, busyText) {
  audio.init(); // 音はクリックの中で開始する必要がある
  for (const id of ['btn-create', 'btn-join', 'btn-range']) $(id).disabled = true;
  titleMsg(busyText);
  try {
    room = await make();
    room.on('lobby', () => lobbyUI.render());
    titleMsg('');
    toLobby();
    return true;
  } catch (err) {
    titleMsg(err.message || String(err));
    return false;
  } finally {
    for (const id of ['btn-create', 'btn-join', 'btn-range']) $(id).disabled = false;
  }
}

$('btn-create').addEventListener('click', () => connect(() => HostRoom.create(playerName()), '部屋を作っています…'));

$('btn-join').addEventListener('click', async () => {
  const code = normalizeCode($('join-code').value);
  if (code.length !== NET.codeLen) { titleMsg(`参加コードは ${NET.codeLen} 文字です`); return; }
  const ok = await connect(() => ClientRoom.join(code, playerName()), '接続しています…');
  if (!ok) return;
  const r = room;
  r.on('start', (msg) => {
    const session = r.startSession(FOUNDRY, msg); // 読み込み中に届く状態を取りこぼさないよう、先に作る
    startGame(() => session);
  });
  r.on('end', () => { if (room === r) toLobby(); });
  r.on('closed', (reason) => { if (room === r) toTitle(reason); });
});
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

$('btn-range').addEventListener('click', () => {
  audio.init();
  const name = playerName();
  startGame(() => new LocalSession(FOUNDRY, name));
});

// ---- 一時停止 / 設定 ----
// 対戦中はメニューを開いてもゲームは止まらない
input.onLockChange = (locked) => {
  if (!game) return;
  if (locked) show(null);
  else if (!game.buyOpen) show('pause'); // 購入メニューを開いた時は、一時停止メニューを出さない
};
$('btn-resume').addEventListener('click', () => { audio.init(); input.lock(); });
$('btn-end').addEventListener('click', () => { room.endGame(); toLobby(); });
$('btn-quit').addEventListener('click', () => toTitle());

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

show('title');
