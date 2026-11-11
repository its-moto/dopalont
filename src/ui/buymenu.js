import { SHOP, WEAPONS } from '../data/weapons.js';
import { RULES } from '../data/rules.js';
import { AGENTS } from '../data/agents.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * 購入メニュー (B キー)。クリックで購入、右クリックで売却
 * 買えるかどうかの最終判断はホストがする。ここは注文を出して、結果を表示するだけ
 */
export class BuyMenu {
  constructor() {
    this.root = $('buy');
    this.session = null;
    this.items = []; // { btn, id, slot, price, armor }
    const grid = $('buy-grid');

    const add = (parent, id, slot, name, price, note, armor = 0) => {
      const btn = el('button', 'item');
      btn.append(el('span', 'iname', name), el('span', 'iprice', price ? String(price) : '無料'), el('span', 'inote', note));
      btn.addEventListener('click', () => this.order(id, price));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.session?.sell(slot); });
      parent.append(btn);
      this.items.push({ btn, id, slot, price, armor });
    };

    for (const group of SHOP) {
      const col = el('div', 'shop-col');
      col.append(el('h3', null, group.category));
      for (const w of group.items) {
        const d = w.damage[0];
        add(col, w.id, w.slot, w.name, w.price, `頭 ${d.head}${w.pellets > 1 ? `×${w.pellets}` : ''} / 胴 ${d.body}　弾 ${w.magSize}`);
      }
      grid.append(col);
    }
    const col = el('div', 'shop-col');
    col.append(el('h3', null, 'アーマー'));
    for (const a of Object.values(RULES.armor)) add(col, a.id, 'armor', a.name, a.price, `+${a.value} (ダメージの 66% を肩代わり)`, a.value);
    grid.append(col);

    // アビリティの列はエージェントごとに違うので、開くたびに作り直す
    this.abilCol = el('div', 'shop-col');
    grid.append(this.abilCol);
    this.abilItems = [];

    $('buy-close').addEventListener('click', () => this.onClose?.());
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.code === 'KeyB' || e.code === 'Escape') { e.preventDefault(); this.onClose?.(); }
    });
  }

  order(id, price) {
    const p = this.session?.me;
    if (!p) return;
    if (price <= p.credits || this.free) this.sfx?.buy(price); else this.sfx?.deny();
    this.session.buy(id); // 足りなく見えても、買い直しの返金で足りる場合があるので注文は出す
  }

  open(session, sfx, onClose) {
    this.session = session; this.sfx = sfx; this.onClose = onClose;
    this.free = !session.round; // 射撃場は無料
    $('buy-note').textContent = this.free
      ? '射撃場ではどの武器も無料で試せます'
      : 'クリックで購入 / 右クリックで売却 (このラウンドに買った物だけ、全額戻ります)';
    this.abilCol.replaceChildren();
    this.abilItems = [];
    const agent = AGENTS[session.me?.agent];
    if (agent && !this.free) {
      this.abilCol.append(el('h3', null, `アビリティ (${agent.name})`));
      for (const k of ['c', 'q', 'e']) {
        const d = agent.abilities[k];
        if (!d.price) continue;
        const btn = el('button', 'item');
        const note = el('span', 'inote', '');
        btn.append(el('span', 'iname', `${k.toUpperCase()} ${d.name}`), el('span', 'iprice', String(d.price)), note);
        btn.title = d.desc;
        btn.addEventListener('click', () => this.order(`ab:${k}`, d.price));
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.session?.sell(`ab:${k}`); });
        this.abilCol.append(btn);
        this.abilItems.push({ btn, note, key: k, def: d });
      }
    }
    this.root.hidden = false;
    this.refresh();
  }

  close() { this.root.hidden = true; }

  refresh() {
    const p = this.session?.me;
    if (!p) return;
    $('buy-credits').textContent = this.free ? '∞' : p.credits;
    for (const it of this.items) {
      const owned = it.armor ? p.armor === it.armor : p.loadout[it.slot] === it.id;
      it.btn.classList.toggle('owned', owned);
      it.btn.classList.toggle('poor', !this.free && !owned && it.price > p.credits);
    }
    for (const it of this.abilItems) {
      const n = p.abil[it.key], full = n >= it.def.max;
      it.note.textContent = `持っている数 ${n} / ${it.def.max}`;
      it.btn.classList.toggle('owned', full);
      it.btn.classList.toggle('poor', !full && it.def.price > p.credits);
    }
  }
}

export const weaponName = (id) => WEAPONS[id]?.name || id;
