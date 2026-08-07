import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert 24-hour time string (HH:mm) to 12-hour format
 * @param time24 - Time in 24-hour format (e.g., "14:30")
 * @param compact - If true, use "a"/"p" instead of "AM"/"PM"
 * @param dropZeroMinutes - If true, drop ":00" for on-the-hour times
 * @returns Time in 12-hour format (e.g., "2:30 PM", "2:30a", or "2a")
 */
export function formatTime12Hour(time24: string | undefined | null, compact?: boolean, dropZeroMinutes?: boolean): string {
  if (!time24) return '--:--';
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? (compact ? 'p' : 'PM') : (compact ? 'a' : 'AM');
  const hours12 = hours % 12 || 12;
  if (dropZeroMinutes && minutes === 0) {
    return `${hours12}${period}`;
  }
  return `${hours12}:${minutes.toString().padStart(2, '0')}${compact ? '' : ' '}${period}`;
}

/**
 * Two-letter monogram: first char of first word + first char of last word.
 * Single word → one letter. Empty/null → "?".
 */
export function getInitials(name?: string | null): string {
  const cleaned = (name || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return '?';
  const parts = cleaned.split(' ');
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
