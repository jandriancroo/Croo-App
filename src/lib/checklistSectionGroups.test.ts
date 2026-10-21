import { describe, it, expect } from 'vitest';
import { placeSectionHeaders } from './checklistSectionGroups';

const t = (id: string) => ({ id, item_type: 'confirmation' });
const h = (id: string) => ({ id, item_type: 'section_header' });

describe('placeSectionHeaders', () => {
  it('header goes with the first task below it', () => {
    const m = placeSectionHeaders([t('a'), h('H'), t('b'), t('c')]);
    expect(m.get('H')).toEqual({ anchorId: 'b', taskIds: ['b', 'c'] });
  });
  it('header followed only by another header goes with the previous task', () => {
    const m = placeSectionHeaders([t('a'), h('H1'), h('H2'), t('b')]);
    expect(m.get('H1')).toEqual({ anchorId: 'a', taskIds: [] });
    expect(m.get('H2')!.anchorId).toBe('b');
  });
  it('first header with nothing below is hidden', () => {
    expect(placeSectionHeaders([h('H')]).get('H')!.anchorId).toBeNull();
  });
});
