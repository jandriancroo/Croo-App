// Theme-aware color utilities for dashboard widgets
// Maps semantic color names to CSS variables and provides nearest-neighbor matching

export type ThemeColorKey = 
  | 'primary'
  | 'accent' 
  | 'destructive'
  | 'secondary'
  | 'muted';

export interface ThemeColor {
  key: ThemeColorKey;
  label: string;
  cssVar: string;
}

// Available theme colors for widgets
export const THEME_COLORS: ThemeColor[] = [
  { key: 'primary', label: 'Primary', cssVar: 'var(--primary)' },
  { key: 'accent', label: 'Accent', cssVar: 'var(--accent)' },
  { key: 'destructive', label: 'Destructive', cssVar: 'var(--destructive)' },
  { key: 'secondary', label: 'Secondary', cssVar: 'var(--secondary)' },
  { key: 'muted', label: 'Muted', cssVar: 'var(--muted)' },
];

// Get computed HSL values from CSS variable
function getComputedHSL(cssVar: string): { h: number; s: number; l: number } | null {
  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);
  
  // Extract variable name from var(--name)
  const varName = cssVar.replace('var(', '').replace(')', '');
  const value = computedStyle.getPropertyValue(varName).trim();
  
  if (!value) return null;
  
  // Parse "h s% l%" or "h s l" format
  const parts = value.split(/\s+/).map(p => parseFloat(p));
  if (parts.length >= 3) {
    return { h: parts[0], s: parts[1], l: parts[2] };
  }
  
  return null;
}

// Convert hex to HSL
function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substr(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substr(2, 2), 16) / 255;
  const b = parseInt(cleanHex.substr(4, 2), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

// Calculate color distance in HSL space (weighted)
function colorDistance(hsl1: { h: number; s: number; l: number }, hsl2: { h: number; s: number; l: number }): number {
  // Hue is circular, so we need special handling
  let hueDiff = Math.abs(hsl1.h - hsl2.h);
  if (hueDiff > 180) hueDiff = 360 - hueDiff;
  
  // Weight hue more heavily than saturation and lightness
  const hWeight = 2;
  const sWeight = 1;
  const lWeight = 1;
  
  return Math.sqrt(
    Math.pow(hueDiff * hWeight, 2) +
    Math.pow((hsl1.s - hsl2.s) * sWeight, 2) +
    Math.pow((hsl1.l - hsl2.l) * lWeight, 2)
  );
}

// Find nearest theme color for a given hex color
export function findNearestThemeColor(hexColor: string): ThemeColorKey {
  const targetHSL = hexToHSL(hexColor);
  
  let nearestKey: ThemeColorKey = 'primary';
  let minDistance = Infinity;
  
  for (const themeColor of THEME_COLORS) {
    const themeHSL = getComputedHSL(themeColor.cssVar);
    if (!themeHSL) continue;
    
    const distance = colorDistance(targetHSL, themeHSL);
    if (distance < minDistance) {
      minDistance = distance;
      nearestKey = themeColor.key;
    }
  }
  
  return nearestKey;
}

// Check if a color is already a theme color key
export function isThemeColorKey(color: string): color is ThemeColorKey {
  return THEME_COLORS.some(tc => tc.key === color);
}

// Get the CSS class for a theme color background
export function getThemeColorClass(colorKey: ThemeColorKey): string {
  switch (colorKey) {
    case 'primary':
      return 'bg-primary';
    case 'accent':
      return 'bg-accent';
    case 'destructive':
      return 'bg-destructive';
    case 'secondary':
      return 'bg-secondary';
    case 'muted':
      return 'bg-muted';
    default:
      return 'bg-primary';
  }
}

// Get the text color class for contrast on theme backgrounds
export function getThemeTextClass(colorKey: ThemeColorKey): string {
  // All theme colors should use white text for consistency
  switch (colorKey) {
    case 'secondary':
    case 'muted':
      return 'text-foreground';
    default:
      return 'text-white';
  }
}

// Migrate a hex color to theme color key
export function migrateAccentColor(color: string): ThemeColorKey {
  if (isThemeColorKey(color)) {
    return color;
  }
  
  // It's a hex color, find nearest theme color
  if (color.startsWith('#')) {
    return findNearestThemeColor(color);
  }
  
  // Default to primary
  return 'primary';
}
