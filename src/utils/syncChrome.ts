// Parse "h s% l%" -> {h, s, l}
function parseHSL(v: string) {
  const [h, s, l] = v.trim().replace(/%/g, '').split(/\s+/).map((n) => parseFloat(n));
  return { h, s, l };
}

/**
 * Single source of truth for chrome color.
 * Reads --header-bg, clamps lightness to <= 52% (iOS auto-dims light status-bar
 * tints for clock contrast; pre-clamping keeps our color aligned with what iOS
 * paints in the safe-area bleed), and writes:
 *   - --chrome-bg on <html> (consumed by html bg + header + nav rules)
 *   - <meta id="theme-color-meta"> content (PWA status-bar)
 */
export function syncChrome() {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue('--header-bg');
  if (!raw) return;

  const { h, s, l } = parseHSL(raw);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return;

  const clampedL = Math.min(l, 52);
  const chrome = `hsl(${h} ${s}% ${clampedL}%)`;

  root.style.setProperty('--chrome-bg', chrome);
  document.getElementById('theme-color-meta')?.setAttribute('content', chrome);
}

// Backward-compat alias — existing callers use syncChromeColor().
export const syncChromeColor = syncChrome;
