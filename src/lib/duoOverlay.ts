/**
 * Duo overlay fallback. Every Dialog / AlertDialog / Sheet that has not been classed by hand
 * picks up the Duo overlay rules automatically: content-heavy dialogs and all sheets become a
 * right slide-over (`duo-slide`), small dialogs and confirms a centered popup (`duo-popup`).
 * Does nothing unless <html> has the `duo` class, so other devices are untouched.
 * Opt out per overlay with a `duo-native` class (full-screen cameras, lightboxes, etc.).
 */
export function duoOverlayClass(className: string | undefined, kind: 'dialog' | 'alert' | 'sheet'): string {
  if (typeof document === 'undefined' || !document.documentElement.classList.contains('duo')) return '';
  const c = className || '';
  if (/duo-|theo-/.test(c)) return '';
  if (/bg-black|max-w-none|w-screen|h-screen|inset-0|(^|\s)p-0(\s|$)/.test(c)) return '';
  if (kind === 'alert') return 'duo-popup';
  if (kind === 'sheet') return 'duo-slide';
  return /max-w-(2xl|3xl|4xl|5xl|6xl|7xl)|overflow-y-auto|overflow-hidden|max-h-|(^|\s)h-\[/.test(c) ? 'duo-slide' : 'duo-popup';
}
