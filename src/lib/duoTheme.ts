import { useEffect, useState } from 'react';

export type DuoThemeMode = 'auto' | 'paper' | 'oled';
const KEY = 'croo-duo-theme-mode';

export function getDuoThemeMode(): DuoThemeMode {
  try { const v = localStorage.getItem(KEY); if (v === 'auto' || v === 'paper' || v === 'oled') return v; } catch { /* ignore */ }
  return 'auto';
}

export function resolveDuoTheme(mode: DuoThemeMode): 'paper' | 'oled' {
  if (mode === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches ? 'oled' : 'paper';
  return mode;
}

/** Applies the saved mode to <html data-duo-theme>. Safe to call repeatedly. */
export function applyDuoTheme(mode: DuoThemeMode = getDuoThemeMode()) {
  document.documentElement.dataset.duoTheme = resolveDuoTheme(mode);
}

export function setDuoThemeMode(mode: DuoThemeMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* ignore */ }
  applyDuoTheme(mode);
  window.dispatchEvent(new Event('duo-theme-mode'));
}

/** Current mode + resolved theme; follows the phone when mode is auto. */
export function useDuoTheme() {
  const [mode, setMode] = useState<DuoThemeMode>(getDuoThemeMode);
  const [theme, setTheme] = useState<'paper' | 'oled'>(() => resolveDuoTheme(getDuoThemeMode()));
  useEffect(() => {
    const sync = () => { const m = getDuoThemeMode(); setMode(m); setTheme(resolveDuoTheme(m)); applyDuoTheme(m); };
    sync();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('duo-theme-mode', sync);
    mq.addEventListener('change', sync);
    return () => { window.removeEventListener('duo-theme-mode', sync); mq.removeEventListener('change', sync); };
  }, []);
  return { mode, theme };
}
