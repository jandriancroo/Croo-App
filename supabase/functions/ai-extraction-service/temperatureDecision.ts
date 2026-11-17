// Decide what to save from the thermometer reads.
// Two reads run in parallel. Agree within 5°F → average, confirmed.
// One fails or they disagree → ONE third tie-break read. If the third agrees
// within 5°F with one of the first two, that pair is averaged and confirmed.
// Otherwise nothing is saved: the crew retakes or fixes the number by hand
// (the photo stays). A wrong number is never saved from a disagreement.
// A read the model flags as unclear (too far, dark, blurry, glare) counts as no
// number; when the reads come back unclear the photo is rejected with a tip.
import { classifyTemp, type EquipmentType, type TempVerdict } from '../_shared/tempBands.ts';

export type TempReason = 'read_failed' | 'reads_disagree' | 'one_read_failed' | 'unclear' | 'implausible';
export type Coaching = 'too_far' | 'too_dark' | 'blurry' | 'glare';
export const COACHING_VALUES: readonly Coaching[] = ['too_far', 'too_dark', 'blurry', 'glare'];

export interface TempRead {
  value: number | null;
  /** Set when the model says the digits/needle aren't legible enough. */
  unclear?: Coaching | null;
  display?: 'digital' | 'dial' | null;
  confidence?: number | null;
  /** false when the model isn't sure of the last (tenths) digit. */
  tenthsSure?: boolean | null;
}

export interface TempDecision {
  temperature: number | null;
  isValid: boolean | null;
  /** Kept for older clients; a number is only ever returned confirmed now. */
  unconfirmed: false;
  reason: TempReason | null;
  coaching: Coaching | null;
  /** True when a third tie-break read settled a disagreement. */
  tiebreak: boolean;
}

export const AGREE_F = 5;
export const isSafeTemp = (t: number) => t <= 41.0 || t >= 135.0;
const avg = (x: number, y: number) => Math.round(((x + y) / 2) * 10) / 10;
// Decimal cut: if either read of the pair isn't sure of the tenths digit, or
// the pair agrees on the whole degree but not the tenths, save the whole
// degree cut toward zero (41.7 → 41, never rounded up).
function pairValue(x: TempRead, y: TempRead): number {
  const vx = x.value as number, vy = y.value as number;
  const sameWhole = Math.trunc(vx) === Math.trunc(vy);
  if (x.tenthsSure === false || y.tenthsSure === false) return sameWhole ? Math.trunc(vx) : Math.trunc(avg(vx, vy));
  if (vx !== vy && sameWhole) return Math.trunc(vx);
  return avg(vx, vy);
}
const agree = (x: number | null, y: number | null): x is number => x != null && y != null && Math.abs(x - y) < AGREE_F;
const valOf = (r: TempRead | null | undefined) => (r && !r.unclear && r.value != null && Number.isFinite(r.value) ? r.value : null);

export const asCoaching = (v: unknown): Coaching | null =>
  typeof v === 'string' && (COACHING_VALUES as readonly string[]).includes(v) ? (v as Coaching) : null;

/** Do the first two reads need a third tie-break read? */
export function needsTiebreak(a: TempRead, b: TempRead): boolean {
  const va = valOf(a), vb = valOf(b);
  if (agree(va, vb)) return false;
  // Both unclear or both failed: a third read won't make a pair.
  if (va == null && vb == null) return false;
  return true;
}

function confirmed(t: number, tiebreak: boolean): TempDecision {
  return { temperature: t, isValid: isSafeTemp(t), unconfirmed: false, reason: null, coaching: null, tiebreak };
}
function none(reason: TempReason, coaching: Coaching | null = null): TempDecision {
  return { temperature: null, isValid: null, unconfirmed: false, reason, coaching, tiebreak: false };
}

/** Most common coaching among unclear reads (first one wins ties). */
function topCoaching(reads: TempRead[]): Coaching | null {
  const counts = new Map<Coaching, number>();
  let best: Coaching | null = null;
  for (const r of reads) {
    if (!r.unclear) continue;
    const n = (counts.get(r.unclear) ?? 0) + 1;
    counts.set(r.unclear, n);
    if (best == null || n > (counts.get(best) ?? 0)) best = r.unclear;
  }
  return best;
}

export function decideReads(a: TempRead, b: TempRead, c?: TempRead | null): TempDecision {
  const va = valOf(a), vb = valOf(b);
  if (agree(va, vb)) return confirmed(pairValue(a, b), false);

  const reads = [a, b, ...(c ? [c] : [])];
  const unclearCount = reads.filter(r => !!r.unclear).length;

  if (c) {
    const vc = valOf(c);
    if (vc != null) {
      const withA = agree(va, vc), withB = agree(vb, vc);
      if (withA && withB) {
        // Third sits between both: pair it with the closer one.
        return Math.abs((va as number) - vc) <= Math.abs((vb as number) - vc)
          ? confirmed(pairValue(a, c), true)
          : confirmed(pairValue(b, c), true);
      }
      if (withA) return confirmed(pairValue(a, c), true);
      if (withB) return confirmed(pairValue(b, c), true);
    }
  }

  // No agreeing pair. Mostly unclear → reject the photo with a tip.
  if (unclearCount >= 2 || (unclearCount >= 1 && reads.every(r => valOf(r) == null))) {
    return none('unclear', topCoaching(reads) ?? 'blurry');
  }
  if (va == null && vb == null) return none('read_failed');
  if (va == null || vb == null) return none('one_read_failed');
  return none('reads_disagree');
}

/** Back-compat wrapper over plain numbers (two reads, optional third). */
export function decideTemperature(a: number | null, b: number | null, c?: number | null): TempDecision {
  return decideReads({ value: a }, { value: b }, c === undefined ? null : { value: c });
}

export interface BandedDecision extends TempDecision {
  /** pass | fail | borderline (hot tags: one retake prompt) | null when no number. */
  verdict: Exclude<TempVerdict, 'implausible'> | null;
  /** The confirmed number that was thrown out as outside the unit's possible range. */
  implausibleValue?: number;
}

/**
 * Apply the equipment tag's bands (_shared/tempBands.ts) to a decision.
 * Outside the possible range → no number (reason 'implausible'): the crew
 * retakes or types it, the photo stays. Otherwise isValid = compliance.
 * Untagged tasks keep today's broad -60..250 check and 41/135 rule.
 */
export function applyBands(d: TempDecision, tag: EquipmentType | null | undefined): BandedDecision {
  if (d.temperature == null) return { ...d, verdict: null };
  const v = classifyTemp(tag, d.temperature);
  if (v === 'implausible') {
    return { temperature: null, isValid: null, unconfirmed: false, reason: 'implausible', coaching: null, tiebreak: d.tiebreak, verdict: null, implausibleValue: d.temperature };
  }
  return { ...d, isValid: v === 'pass', verdict: v };
}
