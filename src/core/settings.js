const KEY = 'valolike.settings.v1';
const DEFAULTS = {
  name: '',
  sens: 0.5,      // 1 カウントあたり sens * 0.07 度
  volume: 0.7,
  fx: 'dopamine', // 'dopamine' | 'subtle' | 'off'
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
