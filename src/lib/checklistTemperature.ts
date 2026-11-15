// Temperature tasks need a photo. Typing a number only corrects the reading
// on a saved photo; it never replaces the photo. The database enforces the
// same rule (trigger trg_guard_temperature_photo on checklist_responses).

export const TEMP_PHOTO_FIRST_MESSAGE = 'Take the photo first';

/** Food safety: cold holding ≤ 41°F, hot holding ≥ 135°F. */
export const isSafeTemperature = (tempF: number): boolean => tempF <= 41 || tempF >= 135;

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
        temperature_validated_at: string;
        temperature_edited_at: string;
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
}): ManualTemperaturePlan {
  const trimmed = input.tempText?.trim() ?? '';
  if (trimmed === '') return { kind: 'invalid', message: 'Please enter a temperature' };
  const tempF = Number(trimmed);
  if (!Number.isFinite(tempF)) return { kind: 'invalid', message: 'Enter a valid temperature' };

  const existing = input.existing;
  if (!existing?.id) return { kind: 'blocked', message: TEMP_PHOTO_FIRST_MESSAGE };
  if (!responseHasPhoto(existing) && !input.canFixLegacy) return { kind: 'blocked', message: TEMP_PHOTO_FIRST_MESSAGE };

  const now = input.nowIso ?? new Date().toISOString();
  const valid = isSafeTemperature(tempF);
  return {
    kind: 'update',
    responseId: existing.id,
    tempF,
    valid,
    fields: {
      extracted_temperature: tempF,
      temperature_valid: valid,
      temperature_unconfirmed: false,
      temperature_validated_at: now,
      temperature_edited_at: now, // server stamps who/when/replaced value
    },
  };
}
