// Temperature tasks need a photo. Typing a number only corrects the reading
// on a saved photo; it never replaces the photo. The database enforces the
// same rule (trigger trg_guard_temperature_photo on checklist_responses).

import { classifyTemp, possibleRange, TEMP_BANDS, isSafeTempUntagged, type EquipmentType } from '../../supabase/functions/_shared/tempBands';

export const TEMP_PHOTO_FIRST_MESSAGE = 'Take the photo first';

/** Food safety: cold holding ≤ 41°F, hot holding ≥ 135°F. */
export const isSafeTemperature = (tempF: number): boolean => isSafeTempUntagged(tempF);

/** True when a saved answer holds a photo (single link or JSON list of links). */
export function responseHasPhoto(row: { response_image_url?: string | null; response_text?: string | null } | null | undefined): boolean {
  if (!row) return false;
  if (typeof row.response_image_url === 'string' && row.response_image_url.trim() !== '') return true;
  const t = row.response_text?.trim();
  if (!t || !t.startsWith('[')) return false;
  try {
    const list = JSON.parse(t);
    return Array.isArray(list) && list.some((u) => typeof u === 'string' && u.trim() !== '');
  } catch {
    return false;
  }
}

/** The database rejects photo-less temperature answers with this marker. */
export const isTempPhotoRequiredError = (error: unknown): boolean =>
  /temp_photo_required/i.test(String((error as { message?: unknown } | null)?.message ?? ''));

export type ManualTemperaturePlan =
  | { kind: 'invalid'; message: string }
  | { kind: 'blocked'; message: string }
  | {
      kind: 'update';
      responseId: string;
      tempF: number;
      valid: boolean;
      /** Only reading columns: the photo and who completed it are never touched. */
      fields: {
        extracted_temperature: number;
        temperature_valid: boolean;
        temperature_unconfirmed: false;
        temperature_edited_at: string;
        /** Cancels any pending background read so it can never overwrite the typed value. */
        temperature_read_token: null;
        temperature_read_status: null;
      };
    };

/**
 * Decide what a typed temperature may do.
 * - Needs a saved answer with a photo.
 * - Old answers saved with no photo can be corrected by shift managers and up
 *   (the same rule the database applies); crew must take the photo.
 */
export function planManualTemperature(input: {
  tempText: string | null | undefined;
  existing: { id: string; response_image_url?: string | null; response_text?: string | null } | null | undefined;
  canFixLegacy: boolean;
  nowIso?: string;
  /** Item's equipment tag; null keeps today's broad check (41°F / 135°F). */
  equipmentType?: EquipmentType | null;
}): ManualTemperaturePlan {
  const trimmed = input.tempText?.trim() ?? '';
  if (trimmed === '') return { kind: 'invalid', message: 'Please enter a temperature' };
  const tempF = Number(trimmed);
  if (!Number.isFinite(tempF)) return { kind: 'invalid', message: 'Enter a valid temperature' };

  const existing = input.existing;
  if (!existing?.id) return { kind: 'blocked', message: TEMP_PHOTO_FIRST_MESSAGE };
  if (!responseHasPhoto(existing) && !input.canFixLegacy) return { kind: 'blocked', message: TEMP_PHOTO_FIRST_MESSAGE };

  const verdict = classifyTemp(input.equipmentType ?? null, tempF);
  if (verdict === 'implausible') {
    const r = possibleRange(input.equipmentType ?? null);
    const what = input.equipmentType ? `a ${TEMP_BANDS[input.equipmentType].label.toLowerCase()}` : 'a thermometer';
    return { kind: 'invalid', message: `${tempF}°F is outside what ${what} reads (${r.min} to ${r.max}°F). Check the number.` };
  }
  const now = input.nowIso ?? new Date().toISOString();
  // A typed number just under a hot line (borderline) saves as failed.
  const valid = verdict === 'pass';
  return {
    kind: 'update',
    responseId: existing.id,
    tempF,
    valid,
    fields: {
      extracted_temperature: tempF,
      temperature_valid: valid,
      temperature_unconfirmed: false,
      temperature_edited_at: now, // server stamps who/when/replaced value
      temperature_read_token: null,
      temperature_read_status: null,
    },
  };
}

export type PhotoReadingPlan =
  | { kind: 'save'; tempF: number; valid: boolean }
  /** Hot tags just under the line: ask for ONE retake, save nothing yet. */
  | { kind: 'retake_borderline'; tempF: number; message: string }
  /** No usable number (incl. outside the unit's possible range): keep the photo, open Fix the number. */
  | { kind: 'no_number'; message: string };

/**
 * What to do with the reader's answer for a photo.
 * - implausible (outside possible range) → no number saved, crew retakes or types.
 * - hot borderline (e.g. 130–134.x for hot holding) → one retake; a retake that is
 *   still under the line saves as failed.
 */
export function planPhotoReading(input: {
  temperature: number | null | undefined;
  reason?: string | null;
  equipmentType?: EquipmentType | null;
  /** True once this task already had its one borderline retake. */
  borderlineRetakeUsed: boolean;
}): PhotoReadingPlan {
  const tag = input.equipmentType ?? null;
  if (input.reason === 'implausible') {
    const r = possibleRange(tag);
    return { kind: 'no_number', message: `That reading doesn't look right for this unit (${r.min} to ${r.max}°F). Retake the photo, or tap Fix the number and type what the thermometer shows.` };
  }
  const t = input.temperature;
  if (t == null || !Number.isFinite(t)) {
    return { kind: 'no_number', message: 'Retake the photo, or tap Fix the number and type what the thermometer shows.' };
  }
  const verdict = classifyTemp(tag, t);
  if (verdict === 'implausible') {
    const r = possibleRange(tag);
    return { kind: 'no_number', message: `That reading doesn't look right for this unit (${r.min} to ${r.max}°F). Retake the photo, or tap Fix the number and type what the thermometer shows.` };
  }
  if (verdict === 'borderline' && !input.borderlineRetakeUsed && tag) {
    const min = TEMP_BANDS[tag].compliance.min;
    return { kind: 'retake_borderline', tempF: t, message: `Read ${t}°F, just under ${min}°F. Take one more photo to be sure.` };
  }
  return { kind: 'save', tempF: t, valid: verdict === 'pass' };
}
