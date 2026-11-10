import { blocked } from '../sim/combat.js';
import { areaAt } from '../sim/map.js';

// 左上の半透明ミニマップ。北が上で固定
// 敵は「自分から見えている間」と、見失ってから少しの間だけ表示する

const SIZE = 200;        // 表示サイズ (CSS px)
const SEEN_HOLD = 1.2;   // 見失ってから表示し続ける秒数
const EYE = 1.5;

export class Minimap {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.map = map;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = SIZE * dpr;
    this.ctx = canvas.getContext('2d');
    this.px = SIZE * dpr;
    this.scale = this.px / Math.max(map.size[0], map.size[1]);
    // マップを中央に寄せる
    this.offX = (this.px - map.size[0] * this.scale) / 2;
    this.offY = (this.px - map.size[1] * this.scale) / 2;
    this.bg = this.drawBackground();
    this.areaEl = document.getElementById('area');
    this.area = '';
    this.seen = new Map(); // 敵 ID → 最後に見えた時刻と位置
    this.time = 0;
    this.tick = 0;
  }

  mx(x) { return this.offX + (x - this.map.origin[0]) * this.scale; }
  my(z) { return this.offY + (z - this.map.origin[1]) * this.scale; }

  /** 壁やサイトは動かないので、最初に 1 回だけ描いておく */
  drawBackground() {
    const c = document.createElement('canvas');
    c.width = c.height = this.px;
    const g = c.getContext('2d'), s = this.scale;
    const rect = (b) => g.fillRect(this.mx(b.min[0]), this.my(b.min[2]), (b.max[0] - b.min[0]) * s, (b.max[2] - b.min[2]) * s);

    g.fillStyle = 'rgba(150,160,180,0.42)'; // 歩ける所
    g.fillRect(this.offX, this.offY, this.map.size[0] * s, this.map.size[1] * s);
    for (const name in this.map.sites) {
      const st = this.map.sites[name];
      g.fillStyle = 'rgba(255,214,90,0.3)';
      g.fillRect(this.mx(st.min[0]), this.my(st.min[1]), (st.max[0] - st.min[0]) * s, (st.max[1] - st.min[1]) * s);
    }
    for (const b of this.map.boxes) {
      if (b.kind === 'wall') { g.fillStyle = 'rgba(12,14,20,0.9)'; rect(b); }
      else if (b.kind === 'roof') { g.fillStyle = 'rgba(12,14,20,0.4)'; rect(b); }
    }
    for (const b of this.map.boxes) {
      if (b.kind !== 'prop') continue;
      g.fillStyle = b.max[1] - b.min[1] > 1.3 ? 'rgba(40,44,56,0.95)' : 'rgba(70,76,92,0.9)';
      rect(b);
    }
    g.font = `bold ${Math.round(this.px * 0.09)}px "Bahnschrift", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,224,130,0.95)';
    for (const name in this.map.sites) {
      const st = this.map.sites[name];
      g.fillText(name, this.mx((st.min[0] + st.max[0]) / 2), this.my((st.min[1] + st.max[1]) / 2));
    }
    return c;
  }

  dot(x, z, r, color) {
    const g = this.ctx;
    g.fillStyle = color;
    g.beginPath(); g.arc(this.mx(x), this.my(z), r, 0, Math.PI * 2); g.fill();
  }

  /** 向きつきの印 (自分と味方) */
  arrow(x, z, yaw, r, color) {
    const g = this.ctx;
    g.save();
    g.translate(this.mx(x), this.my(z));
    g.rotate(-yaw); // yaw=0 で北 (上) を向く
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, -r * 1.5); g.lineTo(r, r); g.lineTo(0, r * 0.45); g.lineTo(-r, r); g.closePath(); g.fill();
    g.restore();
  }

  /**
   * @param view {{x,y,z,yaw}|null} 自分の位置と向き (観戦中は null)
   * @param myTeam 自分のチーム。null なら全員を敵として扱う (射撃場)
   */
  update(dt, view, myTeam, remotes, targets, boxes) {
    this.time += dt;
    if (++this.tick % 2) return; // 1 フレームおきで十分
    const g = this.ctx, u = this.px / SIZE;
    g.clearRect(0, 0, this.px, this.px);
    g.drawImage(this.bg, 0, 0);

    // 現在地 (坂など名前のない所では、直前の名前のまま)
    const area = view ? areaAt(this.map, view.x, view.z) : '';
    if (area && area !== this.area) { this.area = area; this.areaEl.textContent = area; }

    const eye = view ? [view.x, view.y + EYE, view.z] : null;
    for (const t of targets) if (t.alive) this.dot(t.pos.x, t.pos.z, 2.6 * u, '#ff5a4a');

    for (const r of remotes) {
      if (!r.alive) continue;
      if (myTeam && r.team === myTeam) { this.arrow(r.x, r.z, r.yaw, 4 * u, '#4fd2ff'); continue; }
      let s = this.seen.get(r.id);
      if (!s) this.seen.set(r.id, (s = { t: -9, x: 0, z: 0 }));
      if (eye && !blocked(boxes, eye, [r.x, r.y + EYE, r.z])) { s.t = this.time; s.x = r.x; s.z = r.z; }
      const age = this.time - s.t;
      if (age < SEEN_HOLD) {
        g.globalAlpha = 1 - (age / SEEN_HOLD) * 0.7;
        this.dot(s.x, s.z, 4 * u, '#ff4a3c');
        g.globalAlpha = 1;
      }
    }

    if (view) {
      // 視界の扇形
      const cx = this.mx(view.x), cy = this.my(view.z), a = -view.yaw - Math.PI / 2, half = 0.9, len = 34 * u;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, len);
      grad.addColorStop(0, 'rgba(255,255,255,0.32)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, len, a - half, a + half); g.closePath(); g.fill();
      this.arrow(view.x, view.z, view.yaw, 5 * u, '#ffffff');
    }
  }
}
