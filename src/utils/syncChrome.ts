// Parse "h s% l%" -> {h, s, l}
function parseHSL(v: string) {
  const [h, s, l] = v.trim().replace(/%/g, '').split(/\s+/).map((n) => parseFloat(n));
  return { h, s, l };
}

/**
 * Single source of truth for chrome color.
 *
 * iOS 26/27 no longer paints a flat tint behind the status bar: it samples the
 * top rows of the page and renders an adaptive scrim/fade for clock legibility.
 * Any mismatch between the status-bar bleed color, the header color and
 * <meta theme-color> shows up as an ugly gradient band. So we now publish ONE
 * exact color everywhere (no per-platform clamping) and let the OS blur a
 * uniform surface — blurring a single flat color yields that same color, so the
 * fade becomes invisible on iOS 26/27 while staying correct on iOS <=18,
 * Android Chrome and desktop.
 *
 * Writes:
 *   - --chrome-bg on <html> (html bg + safe-area band + header + nav)
 *   - every <meta name="theme-color"> (incl. media-scoped variants)
 */
export function syncChrome() {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue('--header-bg');
  if (!raw) return;

  const { h, s, l } = parseHSL(raw);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return;

  // Only guard against genuinely washed-out themes (iOS would force-dim those
  // anyway, which is what created the visible step). Otherwise: exact match.
  const safeL = l > 70 ? 70 : l;
  const chrome = `hsl(${h} ${s}% ${safeL}%)`;

  root.style.setProperty('--chrome-bg', chrome);

  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length) {
    metas.forEach((m) => m.setAttribute('content', chrome));
  } else {
    document.getElementById('theme-color-meta')?.setAttribute('content', chrome);
  }
}

// Backward-compat alias — existing callers use syncChromeColor().
export const syncChromeColor = syncChrome;
