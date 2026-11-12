import { describe, expect, it } from 'vitest';
import { isTempPhotoRequiredError, planManualTemperature, responseHasPhoto, TEMP_PHOTO_FIRST_MESSAGE } from './checklistTemperature';

const photoRow = { id: 'r1', response_image_url: 'https://x.supabase.co/storage/v1/object/public/checklist-images/u/1.jpg', response_text: null };

describe('saveManualTemperature plan', () => {
  it('keeps the photo: a typed number only writes reading columns', () => {
    const plan = planManualTemperature({ tempText: ' 38 ', existing: photoRow, canFixLegacy: false, nowIso: '2026-11-12T19:00:00.000Z' });
    expect(plan.kind).toBe('update');
    if (plan.kind !== 'update') return;
    expect(plan.responseId).toBe('r1');
    expect(plan.tempF).toBe(38);
    expect(plan.valid).toBe(true);
    expect(plan.fields).toEqual({
      extracted_temperature: 38,
      temperature_valid: true,
      temperature_unconfirmed: false,
      temperature_validated_at: '2026-11-12T19:00:00.000Z',
      temperature_edited_at: '2026-11-12T19:00:00.000Z',
    });
    for (const k of ['response_image_url', 'response_text', 'completed_by']) expect(plan.fields).not.toHaveProperty(k);
  });

  it('flags an out-of-range reading', () => {
    const plan = planManualTemperature({ tempText: '60', existing: photoRow, canFixLegacy: false });
    expect(plan.kind === 'update' && plan.valid).toBe(false);
  });

  it('counts a multi-photo JSON list as a photo', () => {
    const plan = planManualTemperature({ tempText: '140', existing: { id: 'r2', response_image_url: null, response_text: '["https://a/1.jpg"]' }, canFixLegacy: false });
    expect(plan.kind).toBe('update');
  });

  it('blocks typing before any photo is saved', () => {
    expect(planManualTemperature({ tempText: '38', existing: null, canFixLegacy: true })).toEqual({ kind: 'blocked', message: TEMP_PHOTO_FIRST_MESSAGE });
  });

  it('blocks crew on an old reading saved without a photo', () => {
    const legacy = { id: 'r3', response_image_url: null, response_text: '38' };
    expect(planManualTemperature({ tempText: '39', existing: legacy, canFixLegacy: false }).kind).toBe('blocked');
  });

  it('lets managers correct an old reading saved without a photo', () => {
    const legacy = { id: 'r3', response_image_url: null, response_text: '38' };
    expect(planManualTemperature({ tempText: '39', existing: legacy, canFixLegacy: true }).kind).toBe('update');
  });

  it('rejects empty and non-numeric input', () => {
    expect(planManualTemperature({ tempText: '  ', existing: photoRow, canFixLegacy: false }).kind).toBe('invalid');
    expect(planManualTemperature({ tempText: 'abc', existing: photoRow, canFixLegacy: false }).kind).toBe('invalid');
  });
});

describe('photo detection and server error', () => {
  it('detects photos', () => {
    expect(responseHasPhoto(photoRow)).toBe(true);
    expect(responseHasPhoto({ response_text: '[]' })).toBe(false);
    expect(responseHasPhoto({ response_text: '[""]' })).toBe(false);
    expect(responseHasPhoto({ response_text: '[not json' })).toBe(false);
    expect(responseHasPhoto({ response_text: '38' })).toBe(false);
    expect(responseHasPhoto(null)).toBe(false);
  });
  it('recognizes the database rejection', () => {
    expect(isTempPhotoRequiredError({ message: 'temp_photo_required: Take the photo first' })).toBe(true);
    expect(isTempPhotoRequiredError({ message: 'network' })).toBe(false);
    expect(isTempPhotoRequiredError(null)).toBe(false);
  });
});
