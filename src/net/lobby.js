import { MAX_TEAM } from './config.js';

// ロビーの状態と操作。ホストだけが書き換え、全体をクライアントに配る

export function createLobby(code) {
  return { code, players: [], inGame: false };
}

const count = (lobby, team) => lobby.players.filter((p) => p.team === team).length;

/** 人数の少ないチームへ。両方満員なら観戦 */
function pickTeam(lobby) {
  const a = count(lobby, 'attack'), d = count(lobby, 'defense');
  if (a >= MAX_TEAM && d >= MAX_TEAM) return 'spec';
  return a <= d ? 'attack' : 'defense';
}

export function addPlayer(lobby, { id, name, host = false }) {
  const base = (name || 'プレイヤー').slice(0, 16);
  let unique = base, n = 2;
  while (lobby.players.some((p) => p.name === unique)) unique = `${base}${n++}`;
  const p = { id, name: unique, team: pickTeam(lobby), ready: host, host };
  lobby.players.push(p);
  return p;
}

export function removePlayer(lobby, id) {
  lobby.players = lobby.players.filter((p) => p.id !== id);
}

export function setTeam(lobby, id, team) {
  const p = lobby.players.find((q) => q.id === id);
  if (!p || p.team === team) return false;
  if (team !== 'spec' && count(lobby, team) >= MAX_TEAM) return false;
  p.team = team;
  return true;
}

export function setReady(lobby, id, ready) {
  const p = lobby.players.find((q) => q.id === id);
  if (p) p.ready = !!ready;
}

/** 人数差が 1 以下になるまで、多い方の最後の人を少ない方へ移す */
export function autoBalance(lobby) {
  for (;;) {
    const a = count(lobby, 'attack'), d = count(lobby, 'defense');
    if (Math.abs(a - d) <= 1) return;
    const from = a > d ? 'attack' : 'defense';
    const list = lobby.players.filter((p) => p.team === from);
    list[list.length - 1].team = from === 'attack' ? 'defense' : 'attack';
  }
}

export function shuffle(lobby, rnd = Math.random) {
  const active = lobby.players.filter((p) => p.team !== 'spec');
  for (let i = active.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [active[i], active[j]] = [active[j], active[i]];
  }
  active.forEach((p, i) => { p.team = i % 2 ? 'defense' : 'attack'; });
}

export function canStart(lobby) {
  if (!count(lobby, 'attack') || !count(lobby, 'defense')) return { ok: false, reason: '両チームに 1 人以上必要です' };
  const waiting = lobby.players.filter((p) => !p.ready && p.team !== 'spec').length;
  return { ok: true, waiting };
}
