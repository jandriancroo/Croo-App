import { describe, it, expect } from 'vitest';
import { getReferencePhotos, referencePhotoFields } from './checklistReferencePhotos';
import { canUndoChecklistItem } from './checklistUndo';

describe('reference photos', () => {
  it('falls back to the old column', () => {
    expect(getReferencePhotos({ reference_image_url: 'a', reference_image_urls: [] })).toEqual(['a']);
  });
  it('saving from a single-photo editor keeps slots 2+', () => {
    expect(referencePhotoFields({ reference_image_url: 'x', reference_image_urls: ['a', 'b', 'c'] }))
      .toEqual({ reference_image_url: 'x', reference_image_urls: ['x', 'b', 'c'] });
  });
  it('copy keeps whole list and slot 1 mirrors the old column', () => {
    expect(referencePhotoFields({ reference_image_url: 'a', reference_image_urls: ['a', 'b'] }))
      .toEqual({ reference_image_url: 'a', reference_image_urls: ['a', 'b'] });
  });
});

describe('checklist undo', () => {
  it('shift manager can undo anyone', () => expect(canUndoChecklistItem('shift_manager', 'u1', 'u2')).toBe(true));
  it('fbc can undo anyone', () => expect(canUndoChecklistItem('fbc', 'u1', 'u2')).toBe(true));
  it('team member only own', () => {
    expect(canUndoChecklistItem('team_member', 'u1', 'u2')).toBe(false);
    expect(canUndoChecklistItem('team_member', 'u1', 'u1')).toBe(true);
  });
  it('SM in training is not on the policy list', () =>
    expect(canUndoChecklistItem('shift_manager_in_training', 'u1', 'u2')).toBe(false));
});
