import { MAX_TEAM, TEAM_LABEL } from '../net/config.js';
import { canStart } from '../net/lobby.js';

const $ = (id) => document.getElementById(id);
const TEAMS = ['attack', 'defense', 'spec'];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // 名前は必ず textContent で入れる (HTML として解釈させない)
  return e;
}

/**
 * ロビー画面。room.lobby の内容を描くだけで、操作は room に伝える
 * @param handlers {{onStart:()=>void, onLeave:()=>void}}
 */
export class LobbyUI {
  constructor(handlers) {
    this.handlers = handlers;
    this.room = null;
    $('lobby-code').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.room.lobby.code);
        this.note('参加コードをコピーしました');
      } catch { this.note('コピーできませんでした。コードを手で伝えてください'); }
    });
    $('btn-leave').addEventListener('click', () => handlers.onLeave());
    $('btn-ready').addEventListener('click', () => {
      const me = this.me();
      if (me) this.room.act({ type: 'ready', ready: !me.ready });
    });
    $('btn-balance').addEventListener('click', () => this.room.hostAct({ type: 'balance' }));
    $('btn-shuffle').addEventListener('click', () => this.room.hostAct({ type: 'shuffle' }));
    $('btn-start').addEventListener('click', () => handlers.onStart());
    $('lobby-wins').addEventListener('change', (e) => this.room.hostAct({ type: 'wins', value: Number(e.target.value) }));
  }

  me() { return this.room.lobby.players.find((p) => p.id === this.room.myId); }

  note(text) {
    $('lobby-msg').textContent = text;
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => { $('lobby-msg').textContent = ''; }, 3000);
  }

  open(room) {
    this.room = room;
    $('lobby').hidden = false;
    this.render();
  }

  close() { $('lobby').hidden = true; }

  render() {
    const room = this.room;
    if (!room || $('lobby').hidden) return;
    const lobby = room.lobby, me = this.me(), host = room.isHost;
    $('lobby-code').textContent = lobby.code;

    const box = $('lobby-teams');
    box.replaceChildren();
    for (const team of TEAMS) {
      const members = lobby.players.filter((p) => p.team === team);
      const col = el('div', `team ${team}`);
      const head = el('div', 'team-head');
      head.append(el('h3', null, TEAM_LABEL[team]), el('span', 'count', team === 'spec' ? `${members.length}` : `${members.length} / ${MAX_TEAM}`));
      col.append(head);

      const list = el('ul');
      for (const p of members) {
        const li = el('li', p.id === room.myId ? 'me' : null);
        li.append(el('span', 'name', p.name));
        if (p.host) li.append(el('span', 'tag host', 'ホスト'));
        else if (team !== 'spec') li.append(el('span', p.ready ? 'tag ready' : 'tag', p.ready ? '準備OK' : '準備中'));
        if (host && p.id !== room.myId) {
          const ops = el('span', 'ops');
          for (const t of TEAMS) {
            if (t === team) continue;
            const b = el('button', 'mini', `→${TEAM_LABEL[t]}`);
            b.addEventListener('click', () => room.hostAct({ type: 'move', id: p.id, team: t }));
            ops.append(b);
          }
          const k = el('button', 'mini danger', '退出させる');
          k.addEventListener('click', () => room.hostAct({ type: 'kick', id: p.id }));
          ops.append(k);
          li.append(ops);
        }
        list.append(li);
      }
      col.append(list);

      if (me && me.team !== team) {
        const full = team !== 'spec' && members.length >= MAX_TEAM;
        const b = el('button', 'join', full ? '満員' : `${TEAM_LABEL[team]}に入る`);
        b.disabled = full;
        b.addEventListener('click', () => room.act({ type: 'team', team }));
        col.append(b);
      }
      box.append(col);
    }

    // 下のボタン
    $('btn-ready').hidden = host || !me || me.team === 'spec';
    if (me) $('btn-ready').textContent = me.ready ? '準備を取り消す' : '準備完了';
    for (const id of ['btn-balance', 'btn-shuffle', 'btn-start']) $(id).hidden = !host;
    $('lobby-wins').value = String(lobby.settings.wins);
    $('lobby-wins').disabled = !host;
    const st = canStart(lobby);
    $('btn-start').disabled = !st.ok;
    $('btn-start').textContent = st.ok && st.waiting ? `試合開始 (${st.waiting} 人が準備中)` : '試合開始';
    $('lobby-status').textContent = host
      ? (st.ok ? '参加コードを友だちに伝えてください。全員そろったら開始できます' : st.reason)
      : 'ホストが試合を開始するのを待っています';
  }
}
