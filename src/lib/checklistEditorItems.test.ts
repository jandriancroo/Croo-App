import { describe, it, expect } from 'vitest';
import { moveChecklistItems, referenceSlotCount, photosDroppedAt, setReferencePhotos, toItemRow, displayType, duplicateItem } from './checklistEditorItems';

const t = (item_type: string, name: string) => ({ item_type, name });

describe('checklist editor items', () => {
  it('section header drags its whole block', () => {
    const items = [t('section_header', 'A'), t('confirmation', 'a1'), t('section_header', 'B'), t('confirmation', 'b1')];
    expect(moveChecklistItems(items, 2, 0).map((i) => i.name)).toEqual(['B', 'b1', 'A', 'a1']);
  });

  it('header cannot drop inside its own block', () => {
    const items = [t('section_header', 'A'), t('confirmation', 'a1'), t('confirmation', 'a2')];
    expect(moveChecklistItems(items, 0, 1)).toBe(items);
  });

  it('reference slots follow photos required for Photo and Temp Photo, 1 otherwise', () => {
    expect(referenceSlotCount({ item_type: 'image', options: { minPhotos: 3 } })).toBe(3);
    expect(referenceSlotCount({ item_type: 'temperature', options: { minPhotos: 2 } })).toBe(2);
    expect(referenceSlotCount({ item_type: 'confirmation', options: { minPhotos: 3 } })).toBe(1);
    expect(referenceSlotCount({ item_type: 'image', options: null })).toBe(1);
  });

  it('lowering photos required reports how many photos would drop', () => {
    const item = { question: 'x', item_type: 'image', is_required: true, reference_image_urls: ['a', 'b', 'c'] };
    expect(photosDroppedAt(item, 2)).toBe(1);
    expect(photosDroppedAt(item, 3)).toBe(0);
  });

  it('slot 1 is always written to the old single column', () => {
    const item = setReferencePhotos({ question: 'x', item_type: 'image', is_required: true }, ['a', 'b']);
    const row = toItemRow(item, 0, false, false);
    expect(row.reference_image_url).toBe('a');
    expect(row.reference_image_urls).toEqual(['a', 'b']);
    const cleared = toItemRow(setReferencePhotos(item, []), 0, false, false);
    expect(cleared.reference_image_url).toBeNull();
    expect(cleared.reference_image_urls).toEqual([]);
  });

  it('photo count is saved for Photo tasks (the old Create bug)', () => {
    const row = toItemRow({ question: 'x', item_type: 'image', is_required: true, options: { minPhotos: 2 } }, 0, false, false);
    expect(row.options).toEqual({ minPhotos: 2 });
  });

  it('legacy spellings show as their modern type', () => {
    expect(displayType('PHOTO')).toBe('image');
    expect(displayType('CHECKBOX')).toBe('confirmation');
  });

  it('duplicate drops saved ids', () => {
    const d = duplicateItem({ id: 'i1', question: 'x', item_type: 'prep_list', is_required: true, prep_rows: [{ id: 'r1', item_name: 'a', order_index: 0 }] });
    expect(d.id).toBeUndefined();
    expect(d.prep_rows?.[0].id).toBeUndefined();
  });
});
