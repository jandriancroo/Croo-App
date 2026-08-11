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
/**
 * iOS 26/27 installed web apps paint a "liquid glass" scrim over the status bar:
 * it takes the published theme-color and BRIGHTENS it, so a perfect match with
 * the header still reads as a light band fading into the header. Only on that
 * platform do we publish a pre-darkened theme-color so the OS's brighten step
 * lands back on the header color. Everywhere else theme-color === header color.
 */
function isIosStandalone() {
  if (typeof navigator === 'undefined') return false;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
  const standalone = (navigator as any).standalone === true ||
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches);
  return isIos && !!standalone;
}

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

  /**
   * iOS 26/27 installed web apps do NOT paint a flat tint behind the status bar:
   * they lift the sampled color toward white (lighter + desaturated) for clock
   * legibility. That lift is far too strong to cancel with a darker input
   * (the math goes negative), so instead of fighting it we MATCH it: publish the
   * lifted tone as theme-color and blend the top of the header from that tone
   * down into the real header color, so there is no visible seam.
   */
  const ios = isIosStandalone();
  const statusL = ios ? safeL + 0.55 * (100 - safeL) : safeL;
  const statusS = ios ? s * 0.45 : s;
  const statusColor = `hsl(${h} ${statusS}% ${statusL}%)`;
  root.style.setProperty('--chrome-statusbar', statusColor);
  root.dataset.iosGlass = ios ? '1' : '0';

  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length) {
    metas.forEach((m) => m.setAttribute('content', statusColor));
  } else {
    document.getElementById('theme-color-meta')?.setAttribute('content', statusColor);
  }
}


// Backward-compat alias — existing callers use syncChromeColor().
export const syncChromeColor = syncChrome;
