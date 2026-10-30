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

/**
 * The Duo has its own Paper/OLED look. The regular app's seasonal/brand themes (Spookified, Beach,
 * Cupcake, Blaze, Playa...) must never leak into it, so while the Duo shell runs we keep <html data-theme>
 * on the plain base for the resolved Duo theme. Saved preferences are untouched, so regular phones keep theirs.
 */
const DECORATED = new Set(['spookified', 'beach', 'cupcake', 'blaze', 'playa']);
export function guardDuoBaseTheme(): () => void {
  const root = document.documentElement;
  if (!root.classList.contains('duo')) return () => {};
  let busy = false;
  const fix = () => {
    if (busy) return;
    const cur = root.getAttribute('data-theme') || '';
    if (!DECORATED.has(cur)) return;
    busy = true;
    root.setAttribute('data-theme', resolveDuoTheme(getDuoThemeMode()) === 'oled' ? 'oled' : 'default');
    busy = false;
  };
  fix();
  const mo = new MutationObserver(fix);
  mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
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
    const stopGuard = guardDuoBaseTheme();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('duo-theme-mode', sync);
    mq.addEventListener('change', sync);
    return () => { stopGuard(); window.removeEventListener('duo-theme-mode', sync); mq.removeEventListener('change', sync); };
  }, []);
  return { mode, theme };
}
