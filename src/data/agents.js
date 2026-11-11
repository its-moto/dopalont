// エージェントとアビリティのデータ (DESIGN.md §6)。性能は本家寄せ、名前と見た目はオリジナル
//
// キー: c / q = 購入スキル、e = シグネチャー、x = アルティメット
// 共通: name, desc, kind (仕組みの種類。src/sim/abilities.js が解釈する)
//   price / max: 購入価格と持てる数      free: 毎ラウンド無料でもらえる数
//   cooldown: 使った後に再び使えるまでの秒数 (回数ではなく時間で回復するスキル)
//   killsRecharge: このキル数で 1 回ぶん回復      ult: 必要なアルティメットポイント
// 投げ物 (kind: 'throw'): proj = 飛び方、effect = 止まった時や時間切れで起きること
//   proj: speed (m/s), gravity, fuse (秒), bounces (跳ね返る回数), onStop (床で止まったら発動), stick (壁に刺さる)
//   effect: zone (エリア効果) / flash (閃光) / blast (爆発) / recon (索敵)

const smoke = (r, dur) => ({ zone: 'smoke', r, dur });
const fire = (r, dur, dps, healOwner = 0) => ({ zone: 'fire', r, dur, dps, healOwner });

export const AGENTS = {
  gale: {
    id: 'gale', name: 'ゲイル', role: 'デュエリスト', color: 0x7fe3ff, tagline: '風のように飛び込む',
    abilities: {
      c: { name: 'ミストバースト', desc: '投げた先に小さな煙幕', price: 200, max: 2, kind: 'throw',
        proj: { speed: 22, gravity: 14, fuse: 1.2, onStop: true }, effect: smoke(3.4, 4.5) },
      q: { name: 'アップウィンド', desc: '真上に高く跳ぶ', price: 150, max: 2, kind: 'updraft', v: 13 },
      e: { name: 'テイルラッシュ', desc: '進む方向へ一気にダッシュ。2 キルで回復', free: 1, killsRecharge: 2, kind: 'dash', speed: 26, dur: 0.27 },
      x: { name: 'ゲイルエッジ', desc: '投げナイフ 5 本。頭なら一撃、キルで全部戻る', ult: 7, kind: 'weapon', weapon: 'ult_knives' },
    },
  },

  ember: {
    id: 'ember', name: 'エンバー', role: 'デュエリスト', color: 0xff8a3c, tagline: '炎で焼き、炎で治す',
    abilities: {
      c: { name: 'フレアウォール', desc: '前方に炎の壁。敵は焼け、自分は回復', price: 200, max: 1, kind: 'firewall', length: 18, dur: 8, dps: 30, heal: 12 },
      q: { name: 'カーブフラッシュ', desc: 'すぐ炸裂する閃光弾。見た人は目がくらむ', price: 250, max: 2, kind: 'throw',
        proj: { speed: 20, gravity: 4, fuse: 0.55 }, effect: { flash: { dur: 1.1, range: 40 } } },
      e: { name: 'ヒートドロップ', desc: '火炎瓶。敵は焼け、自分は回復。2 キルで回復', free: 1, killsRecharge: 2, kind: 'throw',
        proj: { speed: 16, gravity: 18, fuse: 2, onStop: true }, effect: fire(3.6, 4, 60, 12.5) },
      x: { name: 'リワインド', desc: '10 秒以内にやられても、使った場所に全快で戻る', ult: 6, kind: 'recall', dur: 10 },
    },
  },

  haze: {
    id: 'haze', name: 'ヘイズ', role: 'コントローラー', color: 0xb9a6ff, tagline: '煙で視界を支配する',
    abilities: {
      c: { name: 'ラリービーコン', desc: '足元に設置。範囲内の味方の連射と移動が 10% 速くなる', price: 200, max: 1, kind: 'place',
        effect: { zone: 'stim', r: 6, dur: 12 } },
      q: { name: 'バーンシェル', desc: '遠くまで飛ぶ焼夷弾', price: 250, max: 1, kind: 'throw',
        proj: { speed: 24, gravity: 16, fuse: 2.5, onStop: true, bounces: 1 }, effect: fire(4.2, 7, 60) },
      e: { name: 'スカイカーテン', desc: '狙った場所に長く残る煙幕を落とす', price: 100, max: 3, free: 1, kind: 'aim', range: 55, delay: 1,
        effect: smoke(4.6, 19) },
      x: { name: 'ヘヴンストライク', desc: '狙った場所に 3 秒間の大きな光線', ult: 8, kind: 'aim', range: 80, delay: 2,
        effect: { zone: 'strike', r: 9, dur: 3, dps: 150 } },
    },
  },

  seer: {
    id: 'seer', name: 'シーア', role: 'イニシエーター', color: 0xffe36b, tagline: '隠れた敵を暴き出す',
    abilities: {
      c: { name: 'スカウトドローン', desc: 'まっすぐ飛ぶ偵察機。近くの敵を味方全員に見せる', price: 400, max: 1, kind: 'drone', speed: 7, dur: 6, r: 14 },
      q: { name: 'ショックボルト', desc: 'まっすぐ飛ぶ電撃。当たった所で爆発し、最大 90 ダメージ', price: 150, max: 2, kind: 'throw',
        proj: { speed: 34, gravity: 6, fuse: 1.6, bounces: 0 }, effect: { blast: { r: 4, dmg: 90 } } },
      e: { name: 'ソナーボルト', desc: '刺さった場所から 2 回、見通せる敵を味方全員に見せる', cooldown: 40, kind: 'throw',
        proj: { speed: 34, gravity: 6, fuse: 6, stick: true }, effect: { recon: { r: 30, pulses: 2, interval: 1.2 } } },
      x: { name: 'ピアサー', desc: '壁を貫く光線を 3 発 (各 80 ダメージ)。6 秒で消える', ult: 8, kind: 'weapon', weapon: 'ult_beam', dur: 6 },
    },
  },

  mend: {
    id: 'mend', name: 'メンド', role: 'センチネル', color: 0x6bffb0, tagline: '壁で止め、仲間を立て直す',
    abilities: {
      c: { name: 'アイスウォール', desc: '前方に氷の壁 (30 秒)。撃てば壊せる', price: 400, max: 1, kind: 'icewall', segs: 4, segW: 2.2, thick: 0.8, height: 3, hp: 800, dur: 30, dist: 5 },
      q: { name: 'フロストオーブ', desc: '落ちた場所の全員が遅くなり、跳べなくなる', price: 200, max: 2, kind: 'throw',
        proj: { speed: 18, gravity: 16, fuse: 2, onStop: true }, effect: { zone: 'slow', r: 5, dur: 7, mul: 0.5 } },
      e: { name: 'ヒールオーブ', desc: '狙った味方を 60 回復 (誰も狙っていなければ自分を 30)', cooldown: 45, kind: 'heal', amount: 60, self: 30, over: 5, range: 12 },
      x: { name: 'リヴァイブ', desc: '近くでやられた味方を、その場に全快で生き返らせる', ult: 8, kind: 'revive', range: 12 },
    },
  },
};

export const AGENT_LIST = Object.values(AGENTS);
export const ABILITY_KEYS = ['c', 'q', 'e', 'x'];
