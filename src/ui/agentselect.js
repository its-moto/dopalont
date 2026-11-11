import { AGENTS, AGENT_LIST, ABILITY_KEYS } from '../data/agents.js';
import { TEAM_LABEL } from '../net/config.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // 名前は必ず textContent で入れる
  return e;
}

const ROLE_TEXT = {
  デュエリスト: '先頭で飛び込み、撃ち合いで道を開く役。',
  コントローラー: '煙で視界を切り、味方が進む道と守る場所を作る役。',
  イニシエーター: '隠れた敵を見つけ出し、攻めのきっかけを作る役。',
  センチネル: '壁や回復で持ち場を固め、仲間を支える役。',
};

/** アビリティ 1 個の「手に入れ方」を 1 行で */
function costLine(key, d) {
  if (key === 'x') return `アルティメット　必要ポイント ${d.ult} (キル・デス・設置・解除でたまる)`;
  if (d.cooldown) return `シグネチャー　使った後 ${d.cooldown} 秒で再使用`;
  const parts = [];
  if (d.free) parts.push(`毎ラウンド ${d.free} 回無料`);
  if (d.price) parts.push(`${d.price} クレジットで購入 (最大 ${d.max} 個)`);
  if (d.killsRecharge) parts.push(`${d.killsRecharge} キルで回復`);
  return parts.join('　/　');
}

/**
 * 試合開始後のエージェント選択画面。room.lobby の内容を描き、選択と決定を room に伝える
 * 見ているエージェント (view) と選んでいるエージェント (lobby 上の agent) は別。味方が使用中でも説明は読める
 */
export class AgentSelectUI {
  constructor(sfx) {
    this.sfx = sfx;
    this.room = null;
    this.view = null;
    this.tab = 'info';
    this.lastLeft = -1;
    $('as-lock').addEventListener('click', () => { this.sfx.uiLock(); this.room.act({ type: 'lock' }); });
  }

  me() { return this.room.lobby.players.find((p) => p.id === this.room.myId); }

  open(room) {
    if (this.room !== room || $('agents').hidden) { this.view = null; this.tab = 'info'; }
    this.room = room;
    $('agents').hidden = false;
    this.render();
  }

  close() { $('agents').hidden = true; this.lastLeft = -1; }

  render() {
    const room = this.room, lobby = room.lobby, me = this.me();
    if (!lobby.pick) return;
    const playing = me && me.team !== 'spec';
    if (!this.view) this.view = (playing && me.agent) || AGENT_LIST[0].id;
    const agent = AGENTS[this.view];
    const mates = lobby.players.filter((p) => playing && p.team === me.team);
    const taken = new Map(mates.filter((p) => p !== me).map((p) => [p.agent, p]));

    // 残り時間
    const left = lobby.pick.left;
    $('as-timer').textContent = left;
    $('as-timer').classList.toggle('alarm', left <= 5);
    if (left !== this.lastLeft && left <= 5 && left > 0) this.sfx.uiTick();
    this.lastLeft = left;

    // 左: エージェント一覧
    const grid = $('as-grid');
    grid.replaceChildren();
    for (const a of AGENT_LIST) {
      const used = taken.get(a.id);
      const b = el('button', `as-card${a.id === this.view ? ' viewing' : ''}${playing && me.agent === a.id ? ' picked' : ''}${used ? ' used' : ''}`);
      b.style.setProperty('--c', hex(a.color));
      b.append(el('span', 'as-initial', a.name[0]), el('span', 'as-cname', a.name), el('small', null, used ? `${used.name} が使用中` : a.role));
      b.addEventListener('click', () => {
        this.view = a.id; this.tab = 'info';
        this.sfx.uiClick();
        if (playing && !me.locked && !used) room.act({ type: 'agent', agent: a.id });
        this.render();
      });
      grid.append(b);
    }

    // 中央: 大きな表示
    const portrait = $('as-portrait');
    portrait.style.setProperty('--c', hex(agent.color));
    $('as-letter').textContent = agent.name[0];
    $('as-tagline').textContent = agent.tagline;

    // 右: 説明
    $('as-role').textContent = agent.role;
    $('as-name').textContent = agent.name;
    $('as-name').style.color = hex(agent.color);
    const tabs = $('as-tabs');
    tabs.replaceChildren();
    for (const t of ['info', ...ABILITY_KEYS]) {
      const b = el('button', `as-tab${t === this.tab ? ' on' : ''}`, t === 'info' ? '概要' : t.toUpperCase());
      b.addEventListener('click', () => { this.tab = t; this.sfx.uiClick(); this.render(); });
      tabs.append(b);
    }
    const info = $('as-info');
    info.replaceChildren();
    if (this.tab === 'info') {
      info.append(el('p', 'as-lead', agent.tagline), el('h4', null, agent.role), el('p', null, ROLE_TEXT[agent.role] || ''));
      const list = el('ul', 'as-list');
      for (const k of ABILITY_KEYS) {
        const li = el('li');
        li.append(el('b', null, k.toUpperCase()), el('span', null, agent.abilities[k].name));
        list.append(li);
      }
      info.append(list);
    } else {
      const d = agent.abilities[this.tab];
      info.append(el('h4', null, `${this.tab.toUpperCase()}　${d.name}`), el('p', 'as-lead', d.desc), el('p', 'as-cost', costLine(this.tab, d)));
    }

    // 下: 味方の選択状況と決定ボタン
    const team = $('as-team');
    team.replaceChildren();
    for (const p of mates) {
      const a = AGENTS[p.agent];
      const chip = el('div', `as-chip${p.locked ? ' locked' : ''}${p === me ? ' me' : ''}`);
      chip.style.setProperty('--c', a ? hex(a.color) : '#555');
      chip.append(el('b', null, a ? a.name[0] : '?'), el('span', 'as-pname', p === me ? `${p.name} (自分)` : p.name), el('small', null, p.locked ? `${a.name} で決定` : `${a ? a.name : ''} を選択中…`));
      team.append(chip);
    }
    const enemies = lobby.players.filter((p) => playing && p.team !== me.team && p.team !== 'spec');
    $('as-enemy').textContent = playing
      ? `${TEAM_LABEL[me.team]}側でスタート　相手 ${enemies.length} 人 (決定済み ${enemies.filter((p) => p.locked).length} 人)`
      : '観戦で参加します';
    const lock = $('as-lock');
    lock.hidden = !playing;
    lock.disabled = !playing || me.locked;
    lock.textContent = playing && me.locked ? '決定済み' : `${AGENTS[me?.agent]?.name || ''} で決定`;
  }
}
