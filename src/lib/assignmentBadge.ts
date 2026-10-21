/**
 * Colors for assignment badges. Positions/stations use their stored schedule color;
 * roles use theme tokens from this one map (change here only).
 */
export const ROLE_BADGE_COLOR: Record<string, string> = {
  team_member: 'hsl(var(--chart-3))',
  shift_manager_in_training: 'hsl(var(--chart-4))',
  shift_manager: 'hsl(var(--chart-2))',
  manager: 'hsl(var(--warning))',
  admin: 'hsl(var(--primary))',
};
export const ROLE_BADGE_FALLBACK = 'hsl(var(--chart-5))';

export type AssignmentKind = 'position' | 'station' | 'role' | 'person' | 'none';

export interface AssignmentInfo {
  kind: AssignmentKind;
  text: string;
  /** CSS color; undefined = neutral. */
  color?: string;
  initials?: string;
}

/**
 * Badge style: 15% tint, matching border, text mixed toward the theme's foreground
 * so very light or very dark stored colors stay readable on every theme.
 */
export function badgeStyle(color?: string): React.CSSProperties | undefined {
  if (!color) return undefined;
  return {
    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
    color: `color-mix(in srgb, ${color} 65%, hsl(var(--foreground)))`,
  };
}
