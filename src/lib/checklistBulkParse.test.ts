import { describe, it, expect } from 'vitest';
import { parseBulkText, parseCsvTasks, itemsFromExtracted } from './checklistBulkParse';

describe('bulk paste keeps the old rules', () => {
  it('prefixes set type, other lines are checks', () => {
    const r = parseBulkText('Photo: Line\nTemp: Walk-in\nText: Notes\nChoice: Clean? | Yes, No\nWipe tables\n\n');
    expect(r.map((i) => [i.question, i.item_type])).toEqual([
      ['Line', 'image'], ['Walk-in', 'temperature'], ['Notes', 'text'], ['Clean?', 'multiple_choice'], ['Wipe tables', 'confirmation'],
    ]);
    expect(r[3].options).toEqual(['Yes', 'No']);
  });
});

describe('CSV', () => {
  it('skips header, reads type and notes', () => {
    const { items } = parseCsvTasks('Task,Type,Notes\n"Sweep, mop",Photo,Use red mop\nCount safe,,\nOpening,Section,');
    expect(items.map((i) => [i.question, i.item_type, i.reference_notes])).toEqual([
      ['Sweep, mop', 'image', 'Use red mop'], ['Count safe', 'confirmation', undefined], ['Opening', 'section_header', undefined],
    ]);
  });
  it('caps at 500 rows', () => {
    const r = parseCsvTasks(Array.from({ length: 600 }, (_, i) => `T${i}`).join('\n'));
    expect(r.items.length).toBe(500);
    expect(r.truncated).toBe(true);
  });
});

describe('read from file', () => {
  it('defaults to check', () => {
    expect(itemsFromExtracted([{ name: 'A', type: 'other' }, { name: 'B', type: 'photo' }]).map((i) => i.item_type)).toEqual(['confirmation', 'image']);
  });
});
