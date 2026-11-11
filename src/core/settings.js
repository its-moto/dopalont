const KEY = 'valolike.settings.v1';
const DEFAULTS = {
  name: '',
  sens: 0.5,      // 1 カウントあたり sens * 0.07 度
  volume: 0.7,
  fx: 'dopamine', // 'dopamine' | 'subtle' | 'off'
  agent: 'gale',  // 射撃場で使うエージェント
  volStep: 1,     // 足音の音量 (全体の音量に掛ける)
  volFx: 1,       // 演出音の音量
  quality: 'high', // 'high' | 'mid' | 'low'
  chColor: '#3dffb0', chLen: 7, chGap: 4, chThick: 2, chDot: true, // クロスヘア
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 保存できなくても遊べる */ }
}
