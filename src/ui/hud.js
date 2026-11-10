import * as THREE from 'three';
import { TEAM_LABEL } from '../net/config.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const PHASE_LABEL = { buy: '購入フェーズ', live: '戦闘中', planted: 'スパイク設置中', end: 'ラウンド終了', over: '試合終了' };

/** CSS アニメーションを最初からやり直す */
export function retrigger(el, ...classes) {
  el.classList.remove('show', 'flash', 'rainbow', 'head', 'kill', ...classes);
  void el.offsetWidth;
  el.classList.add(...classes);
}

function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text; // プレイヤー名は必ず textContent で入れる
  return s;
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.el = {
      hp: $('hp'), armor: $('armor'), name: $('weapon-name'), ammo: $('ammo'), mag: $('ammo-mag'), res: $('ammo-res'),
      reload: $('reload-bar'), reloadFill: $('reload-bar').firstElementChild, weapon: $('weapon'), vitals: $('vitals'),
      hit: $('hitmarker'), dmg: $('dmg-layer'), crosshair: $('crosshair'), hurt: $('hurt'),
      kills: $('st-kills'), hs: $('st-hs'), acc: $('st-acc'), fps: $('st-fps'),
      scorebar: $('scorebar'), sa: $('score-attack'), sd: $('score-defense'),
      feed: $('killfeed'), death: $('death'), deathSub: $('death-sub'), board: $('scoreboard'),
      timer: $('round-timer'), label: $('round-label'), credits: $('credits'), creditsVal: $('credits-val'),
      status: $('status'), progress: $('progress'), progressLabel: $('progress-label'), progressFill: $('progress-fill'),
      banner: $('banner'), bannerMain: $('banner-main'), bannerSub: $('banner-sub'), scope: $('scope'),
    };
    this.cache = {};
    this.fpsT = 0; this.fpsN = 0; this.boardT = 0;
    this.bannerTimer = 0;
  }

  show(on) { this.root.hidden = !on; }

  /** 対戦か射撃場かで出すものを切り替える */
  setMode(net, myTeam) {
    this.el.scorebar.hidden = !net;
    this.el.feed.replaceChildren();
    this.el.death.hidden = true;
    this.el.board.hidden = true;
    this.el.credits.hidden = true;
    this.el.progress.hidden = true;
    this.el.scope.hidden = true;
    this.el.status.textContent = '';
    if (!this.keepBanner) this.banner('', '', '', 0.01);
    this.keepBanner = false;
    this.cache = {};
    if (net) {
      // 自分のチームは青、相手は赤で表示する
      this.el.sa.parentElement.className = `attack ${myTeam === 'attack' ? 'mine' : myTeam === 'defense' ? 'theirs' : ''}`;
      this.el.sd.parentElement.className = `defense ${myTeam === 'defense' ? 'mine' : myTeam === 'attack' ? 'theirs' : ''}`;
    }
  }

  set(key, el, value) {
    if (this.cache[key] === value) return; // 変わった時だけ DOM を触る
    this.cache[key] = value;
    el.textContent = value;
  }

  /** @param p 自分のプレイヤー (観戦中は null) */
  update(dt, p, world, stats) {
    const e = this.el, playing = !!p && p.alive;
    e.weapon.hidden = !playing; e.vitals.hidden = !p; e.crosshair.hidden = !playing;
    if (p) {
      const w = p.weapons[p.slot];
      this.set('hp', e.hp, Math.max(0, Math.ceil(p.hp)));
      e.hp.classList.toggle('low', p.hp <= 30);
      this.set('armor', e.armor, p.armor);
      this.set('name', e.name, w.def.name);
      this.set('mag', e.mag, w.def.melee ? '-' : w.ammo);
      this.set('res', e.res, w.def.melee ? '' : world.infiniteReserve ? '∞' : w.reserve);
      e.ammo.classList.toggle('low', !w.def.melee && w.ammo <= Math.ceil(w.def.magSize * 0.25));
      const reloading = w.reloadEnd > 0;
      e.reload.classList.toggle('on', reloading);
      if (reloading) e.reloadFill.style.width = `${(1 - (w.reloadEnd - world.time) / w.def.reloadTime) * 100}%`;
      e.crosshair.style.opacity = p.ads ? 0.55 : 1;
    }
    this.set('kills', e.kills, stats.kills);
    this.set('hs', e.hs, stats.kills ? `${Math.round((stats.hs / stats.kills) * 100)}%` : '-');
    this.set('acc', e.acc, stats.shots ? `${Math.min(100, Math.round((stats.hits / stats.shots) * 100))}%` : '-');
    this.fpsT += dt; this.fpsN++;
    if (this.fpsT >= 0.5) { this.set('fps', e.fps, Math.round(this.fpsN / this.fpsT)); this.fpsT = 0; this.fpsN = 0; }
  }

  /** 上のバー: スコア、残り時間、ラウンドの状況 */
  round(r, aliveA, aliveD) {
    const e = this.el, t = Math.max(0, Math.ceil(r.timer));
    this.set('sa', e.sa, r.score.attack);
    this.set('sd', e.sd, r.score.defense);
    this.set('timer', e.timer, r.phase === 'over' ? '--:--' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    e.timer.classList.toggle('alarm', r.phase === 'planted' || (r.phase === 'live' && t <= 10));
    this.set('label', e.label, `ラウンド ${r.number}${r.overtime ? ' (延長)' : ''}・${PHASE_LABEL[r.phase]}・生存 ${aliveA} 対 ${aliveD}・${r.winsNeeded} 本先取`);
  }

  credits(n) {
    this.el.credits.hidden = n == null;
    if (n != null) this.set('credits', this.el.creditsVal, n);
  }

  /** 画面下の案内 (今できること) */
  status(text) { this.set('status', this.el.status, text); }

  /** 設置・解除の進み具合。frac が null なら隠す */
  progress(label, frac) {
    const e = this.el;
    e.progress.hidden = frac == null;
    if (frac == null) return;
    this.set('progressLabel', e.progressLabel, label);
    e.progressFill.style.width = `${Math.min(1, frac) * 100}%`;
  }

  /** 中央上の大きな知らせ。secs が 0 なら出しっぱなし */
  banner(main, sub, cls, secs) {
    const e = this.el;
    clearTimeout(this.bannerTimer);
    e.bannerMain.textContent = main;
    e.bannerSub.textContent = sub;
    e.banner.className = cls || '';
    retrigger(e.banner, 'show');
    if (secs > 0) this.bannerTimer = setTimeout(() => e.banner.classList.remove('show'), secs * 1000);
  }

  scope(on) { this.el.scope.hidden = !on; }

  hitmarker(part, killed) {
    retrigger(this.el.hit, 'show', ...(killed ? ['kill'] : part === 'head' ? ['head'] : []));
  }

  hurt() { retrigger(this.el.hurt, 'show'); }

  death(show, sub) {
    this.el.death.hidden = !show;
    if (show) this.set('deathSub', this.el.deathSub, sub);
  }

  /** 命中した場所にダメージ数値を浮かべる */
  damageNumber(point, damage, part, camera) {
    _v.set(point[0], point[1] + 0.25, point[2]).project(camera);
    if (_v.z > 1) return;
    const d = document.createElement('div');
    d.className = part === 'head' ? 'dmg head' : 'dmg';
    d.textContent = damage;
    d.style.left = `${(_v.x * 0.5 + 0.5) * 100}%`;
    d.style.top = `${(-_v.y * 0.5 + 0.5) * 100}%`;
    d.addEventListener('animationend', () => d.remove());
    this.el.dmg.appendChild(d);
  }

  /** キルログ。a/b: { name, ally } */
  killfeed(killer, victim, headshot, mine) {
    const row = document.createElement('div');
    row.className = mine ? 'kf mine' : 'kf';
    row.append(span(killer.ally ? 'ally' : 'enemy', killer.name), span(headshot ? 'how hs' : 'how', headshot ? 'HS ▶' : '▶'), span(victim.ally ? 'ally' : 'enemy', victim.name));
    this.pushFeed(row);
  }

  notice(text) {
    const row = document.createElement('div');
    row.className = 'kf';
    row.textContent = text;
    this.pushFeed(row);
  }

  pushFeed(row) {
    row.addEventListener('animationend', () => row.remove());
    this.el.feed.appendChild(row);
    while (this.el.feed.children.length > 6) this.el.feed.firstChild.remove();
  }

  /** Tab を押している間のスコアボード */
  scoreboard(show, dt, roster, myId) {
    const box = this.el.board;
    if (!show) { box.hidden = true; this.boardT = 0; return; }
    this.boardT -= dt;
    if (!box.hidden && this.boardT > 0) return;
    this.boardT = 0.25;
    box.hidden = false;
    box.replaceChildren();
    const mine = roster.get(myId)?.team;
    for (const team of ['attack', 'defense']) {
      const list = [...roster.values()].filter((r) => r.team === team).sort((a, b) => b.kills - a.kills);
      const table = document.createElement('table');
      const cap = document.createElement('caption');
      cap.className = mine && mine !== 'spec' ? (team === mine ? 'ally' : 'enemy') : '';
      cap.textContent = `${TEAM_LABEL[team]}  ${list.reduce((s, r) => s + r.kills, 0)} キル`;
      table.append(cap);
      const head = table.insertRow();
      for (const [t, c] of [['プレイヤー', ''], ['キル', 'n'], ['デス', 'n']]) {
        const th = document.createElement('th');
        th.textContent = t; th.className = c;
        head.append(th);
      }
      for (const r of list) {
        const tr = table.insertRow();
        if (r.id === myId) tr.className = 'me';
        tr.insertCell().textContent = r.name;
        for (const v of [r.kills, r.deaths]) { const td = tr.insertCell(); td.textContent = v; td.className = 'n'; }
      }
      box.append(table);
    }
  }
}
