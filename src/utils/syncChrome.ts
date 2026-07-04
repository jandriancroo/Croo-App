export function syncChromeColor() {
  const styles = getComputedStyle(document.documentElement);
  const headerBg = styles.getPropertyValue('--header-bg').trim(); // "h s% l%"
  if (!headerBg) return;
  document.getElementById('theme-color-meta')
    ?.setAttribute('content', `hsl(${headerBg})`);
}
