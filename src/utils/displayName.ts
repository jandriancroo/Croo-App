/**
 * Returns the display name for a user.
 * If a nickname is set, replaces the first name with the nickname.
 * e.g. full_name="Robert Smith", nickname="Bobby" → "Bobby Smith"
 */
export function getDisplayName(
  fullName: string | null | undefined,
  nickname?: string | null
): string {
  if (!fullName) return nickname || 'Unknown';
  if (!nickname?.trim()) return fullName;

  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) {
    // Only one name part — just use nickname
    return nickname.trim();
  }

  // Replace first name with nickname, keep last name(s)
  return [nickname.trim(), ...parts.slice(1)].join(' ');
}

/**
 * Get initials from a display name (up to 2 chars).
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
