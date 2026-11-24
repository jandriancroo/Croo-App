// Background thermometer reads (per-store switch location_settings.background_temp_reads_enabled).
// Pure rules shared by the server (ai-extraction-service extract-temperature-bg)
// and the app, so both decide the same way. Mirrors planPhotoReading.
import { classifyTemp, type EquipmentType } from './tempBands.ts';

export type BgReadStatus = 'reading' | 'saved' | 'failed';
export const BG_READ_BUDGET_MS = 55_000;
export const BG_CLIENT_TIMEOUT_MS = 60_000;
export const JUMP_F = 4;

/** Reasons where the photo is rejected (not kept as a reading) and a retake tip shows. */
export const BG_REJECT_REASONS = ['unclear', 'defrost_or_error', 'borderline_retake'] as const;
export const isBgRejected = (status: unknown, reason: unknown) =>
  status === 'failed' && typeof reason === 'string' && (BG_REJECT_REASONS as readonly string[]).includes(reason);

/** Newest photo wins: a result applies only while the row still carries this read's token. */
export const isCurrentReadToken = (rowToken: string | null | undefined, token: string | null | undefined) =>
  !!rowToken && !!token && rowToken === token;

export type BgOutcome =
  | { status: 'saved'; tempF: number; valid: boolean }
  | { status: 'failed'; reason: string; coaching: string | null; tempF?: number };

export function planBackgroundOutcome(input: {
  temperature: number | null | undefined;
  reason?: string | null;
  coaching?: string | null;
  defrostOrError?: boolean;
  equipmentType?: EquipmentType | null;
  borderlineRetakeUsed?: boolean;
}): BgOutcome {
  const tag = input.equipmentType ?? null;
  const t = input.temperature;
  const hasNum = t != null && Number.isFinite(t);
  if (!hasNum && input.defrostOrError) return { status: 'failed', reason: 'defrost_or_error', coaching: 'defrost_or_error' };
  if (input.reason === 'unclear') return { status: 'failed', reason: 'unclear', coaching: input.coaching ?? 'blurry' };
  if (input.reason === 'implausible') return { status: 'failed', reason: 'implausible', coaching: null };
  if (!hasNum) return { status: 'failed', reason: input.reason ?? 'read_failed', coaching: null };
  const verdict = classifyTemp(tag, t as number);
  if (verdict === 'implausible') return { status: 'failed', reason: 'implausible', coaching: null };
  if (verdict === 'borderline' && tag && !input.borderlineRetakeUsed) return { status: 'failed', reason: 'borderline_retake', coaching: null, tempF: t as number };
  return { status: 'saved', tempF: t as number, valid: verdict === 'pass' };
}

/** Median of up to the last 5 earlier valid readings; flag when ≥3 exist and the new one is > 4°F away. */
export function jumpCheck(newTemp: number, earlier: (number | null | undefined)[]): { flag: boolean; baseline: number | null } {
  const vals = earlier.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).slice(0, 5);
  if (vals.length < 3) return { flag: false, baseline: null };
  const s = [...vals].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const median = Math.round(m * 10) / 10;
  return Math.abs(newTemp - median) > JUMP_F ? { flag: true, baseline: median } : { flag: false, baseline: null };
}
