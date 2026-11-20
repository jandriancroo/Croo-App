/**
 * Punch-time 6-digit PIN prompt helpers (pure). The server
 * (punch_clock_set_six_digit_pin) does the real checks: easy-guess list,
 * same-store duplicate, lockout, hash-only save. Never log a PIN.
 */
export const SIX = 6;

export type UpgradeMode = 'new' | 'extend';
export type ExtendSide = 'front' | 'end';

/** Digits only, capped. */
export function digitsOnly(value: string, max: number): string {
  return value.replace(/\D/g, '').slice(0, max);
}

/** Keep the current 4 digits and add 2 to the front or the end. */
export function composeExtendedPin(current4: string, added: string, side: ExtendSide): string {
  const base = digitsOnly(current4, 4);
  const extra = digitsOnly(added, 2);
  return side === 'front' ? extra + base : base + extra;
}

/** The 6-digit PIN the employee is choosing, for either mode. */
export function chosenPin(mode: UpgradeMode, newPin: string, current4: string, added: string, side: ExtendSide): string {
  return mode === 'extend' ? composeExtendedPin(current4, added, side) : digitsOnly(newPin, SIX);
}

/** Save is enabled only with 6 digits in both boxes and a match. */
export function canSaveSixDigit(pin: string, confirm: string): boolean {
  return /^\d{6}$/.test(pin) && /^\d{6}$/.test(confirm) && pin === confirm;
}

/** Shown under the boxes once both are full and differ. */
export function mismatchMessage(pin: string, confirm: string): string | null {
  if (pin.length === SIX && confirm.length === SIX && pin !== confirm) return "PINs don't match.";
  return null;
}

/** Apply one keypad tap to a field value. */
export function applyKey(value: string, key: string, max: number): string {
  if (key === 'back') return value.slice(0, -1);
  if (key === 'clear') return '';
  if (/^\d$/.test(key) && value.length < max) return value + key;
  return value;
}
