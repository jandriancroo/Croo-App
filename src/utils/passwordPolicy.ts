/**
 * Mirrors the password rules enforced by the `user-service` edge function
 * (`set-password`). Keep both in sync — the client copy exists so admins see
 * the rules up front instead of a raw server error after submitting.
 */
export const PASSWORD_MIN_LENGTH = 10;

const WEAK_PATTERNS = [
  /^(.)\1+$/, // all the same character
  /^(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/i,
];
const COMMON_WORDS = /(password|croohq|welcome|letmein|qwerty|123456)/i;
const CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/];

export interface PasswordCheck {
  valid: boolean;
  /** First failing rule, ready to show to the admin. */
  message: string | null;
  rules: { label: string; met: boolean }[];
}

export function checkPassword(password: string): PasswordCheck {
  const longEnough = password.length >= PASSWORD_MIN_LENGTH;
  const classCount = CLASSES.filter((r) => r.test(password)).length;
  const enoughClasses = classCount >= 3;
  const notGuessable =
    password.length > 0 &&
    !COMMON_WORDS.test(password) &&
    !WEAK_PATTERNS.some((r) => r.test(password));

  const rules = [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: longEnough },
    { label: 'Three of: lowercase, uppercase, number, symbol', met: enoughClasses },
    { label: 'Not a common word or sequence', met: notGuessable },
  ];

  let message: string | null = null;
  if (!longEnough) message = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  else if (!enoughClasses)
    message = 'Password must include at least three of: lowercase, uppercase, number, symbol';
  else if (!notGuessable)
    message = 'Password is too easily guessable — choose something less predictable';

  return { valid: !message, message, rules };
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?';

/** Generates a temporary password that always satisfies the server rules. */
export function generateTempPassword(length = 12): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const rand = (set: string) => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return set[buf[0] % set.length];
  };

  let out = [rand(UPPER), rand(LOWER), rand(DIGITS), rand(SYMBOLS)];
  while (out.length < Math.max(length, PASSWORD_MIN_LENGTH)) out.push(rand(all));

  // Fisher–Yates shuffle with crypto randomness
  for (let i = out.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }

  const candidate = out.join('');
  return checkPassword(candidate).valid ? candidate : generateTempPassword(length);
}
