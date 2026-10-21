// Decide what to save from the two thermometer reads.
// Agree within 5°F → average, confirmed. One fails or they disagree → save the
// best read (the one that worked, else the first) as unconfirmed. Both fail → null.
export type TempReason = 'read_failed' | 'reads_disagree' | 'one_read_failed';
export interface TempDecision {
  temperature: number | null;
  isValid: boolean | null;
  unconfirmed: boolean;
  reason: TempReason | null;
}

export const isSafeTemp = (t: number) => t <= 41.0 || t >= 135.0;

export function decideTemperature(a: number | null, b: number | null): TempDecision {
  if (a == null && b == null) return { temperature: null, isValid: null, unconfirmed: false, reason: 'read_failed' };
  if (a == null || b == null) {
    const t = (a ?? b) as number;
    return { temperature: t, isValid: isSafeTemp(t), unconfirmed: true, reason: 'one_read_failed' };
  }
  if (Math.abs(a - b) >= 5) return { temperature: a, isValid: isSafeTemp(a), unconfirmed: true, reason: 'reads_disagree' };
  const t = Math.round(((a + b) / 2) * 10) / 10;
  return { temperature: t, isValid: isSafeTemp(t), unconfirmed: false, reason: null };
}
