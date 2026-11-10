import { NET } from './config.js';

// PeerJS の薄いラッパー。Peer は index.html の <script> で読み込んだグローバル

export function makeCode() {
  let s = '';
  for (let i = 0; i < NET.codeLen; i++) s += NET.codeChars[Math.floor(Math.random() * NET.codeChars.length)];
  return s;
}

export const normalizeCode = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, NET.codeLen);

const peerOptions = () => ({ config: { iceServers: NET.iceServers } });

const ERRORS = {
  'peer-unavailable': 'その参加コードの部屋が見つかりません',
  'network': '接続サーバーに繋がりません。ネットワークを確認してください',
  'server-error': '接続サーバーでエラーが起きました。少し待って試してください',
  'browser-incompatible': 'このブラウザは対応していません (Chrome か Edge を使ってください)',
};
const describe = (err) => ERRORS[err?.type] || `接続エラー: ${err?.type || err?.message || err}`;

/** 部屋を開く。コードが他の部屋とぶつかったら作り直す */
export function openHost() {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') { reject(new Error('通信ライブラリを読み込めませんでした')); return; }
    let tries = 0;
    const attempt = () => {
      const code = makeCode();
      const peer = new Peer(NET.idPrefix + code, peerOptions());
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('接続サーバーから応答がありません')); }, NET.connectTimeout);
      peer.once('open', () => { clearTimeout(timer); resolve({ peer, code }); });
      peer.once('error', (err) => {
        clearTimeout(timer);
        peer.destroy();
        if (err.type === 'unavailable-id' && ++tries < 5) attempt();
        else reject(new Error(describe(err)));
      });
    };
    attempt();
  });
}

/** コードの部屋に接続する */
export function joinHost(code) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') { reject(new Error('通信ライブラリを読み込めませんでした')); return; }
    const peer = new Peer(peerOptions());
    let done = false;
    const fail = (msg) => { if (done) return; done = true; clearTimeout(timer); peer.destroy(); reject(new Error(msg)); };
    const timer = setTimeout(() => fail('時間内に接続できませんでした。回線の相性で繋がらない可能性があります'), NET.connectTimeout);
    peer.on('error', (err) => fail(describe(err)));
    peer.once('open', () => {
      const conn = peer.connect(NET.idPrefix + code, { reliable: true });
      conn.once('open', () => { if (done) return; done = true; clearTimeout(timer); resolve({ peer, conn }); });
      conn.once('error', (err) => fail(describe(err)));
    });
  });
}
