import { MAX_TEAM } from './config.js';
import { AGENTS, AGENT_LIST } from '../data/agents.js';

// ロビーの状態と操作。ホストだけが書き換え、全体をクライアントに配る

export function createLobby(code) {
  return { code, players: [], inGame: false, settings: { wins: 13 } };
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
  const p = { id, name: unique, team: pickTeam(lobby), ready: host, host, agent: null };
  lobby.players.push(p);
  fixAgent(lobby, p);
  return p;
}

/** 同じチームで使われていないエージェントの一覧 */
function freeAgents(lobby, p) {
  const taken = new Set(lobby.players.filter((q) => q !== p && q.team === p.team && p.team !== 'spec').map((q) => q.agent));
  return AGENT_LIST.filter((a) => !taken.has(a.id));
}

/** 選んでいるエージェントがチーム内で重なっていたら、空いているものに替える */
function fixAgent(lobby, p) {
  const free = freeAgents(lobby, p);
  if (!p.agent || !free.some((a) => a.id === p.agent)) p.agent = (free[0] || AGENT_LIST[0]).id;
}

/** 同じチーム内では重複できない */
export function setAgent(lobby, id, agent) {
  const p = lobby.players.find((q) => q.id === id);
  if (!p || !AGENTS[agent] || !freeAgents(lobby, p).some((a) => a.id === agent)) return false;
  p.agent = agent;
  return true;
}

export function removePlayer(lobby, id) {
  lobby.players = lobby.players.filter((p) => p.id !== id);
}

export function setTeam(lobby, id, team) {
  const p = lobby.players.find((q) => q.id === id);
  if (!p || p.team === team) return false;
  if (team !== 'spec' && count(lobby, team) >= MAX_TEAM) return false;
  p.team = team;
  fixAgent(lobby, p);
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
    const moved = list[list.length - 1];
    moved.team = from === 'attack' ? 'defense' : 'attack';
    fixAgent(lobby, moved);
  }
}

export function shuffle(lobby, rnd = Math.random) {
  const active = lobby.players.filter((p) => p.team !== 'spec');
  for (let i = active.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [active[i], active[j]] = [active[j], active[i]];
  }
  active.forEach((p, i) => { p.team = i % 2 ? 'defense' : 'attack'; });
  for (const p of active) p.agent = null;
  for (const p of active) fixAgent(lobby, p);
}

export function canStart(lobby) {
  if (!count(lobby, 'attack') || !count(lobby, 'defense')) return { ok: false, reason: '両チームに 1 人以上必要です' };
  const waiting = lobby.players.filter((p) => !p.ready && p.team !== 'spec').length;
  return { ok: true, waiting };
}
