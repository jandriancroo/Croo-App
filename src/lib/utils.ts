import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert 24-hour time string (HH:mm) to 12-hour format with AM/PM
 * @param time24 - Time in 24-hour format (e.g., "14:30")
 * @param compact - If true, use "a"/"p" instead of "AM"/"PM" and drop minutes if :00
 * @returns Time in 12-hour format (e.g., "2:30 PM" or "2:30p")
 */
export function formatTime12Hour(time24: string | undefined | null, compact?: boolean): string {
  if (!time24) return '--:--';
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? (compact ? 'p' : 'PM') : (compact ? 'a' : 'AM');
  const hours12 = hours % 12 || 12;
  if (compact && minutes === 0) {
    return `${hours12}${period}`;
  }
  return `${hours12}:${minutes.toString().padStart(2, '0')}${compact ? '' : ' '}${period}`;
}
