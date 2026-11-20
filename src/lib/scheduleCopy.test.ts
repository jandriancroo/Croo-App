import { describe, expect, it } from 'vitest';
import {
  buildCopyRows, mergeSkipDupes, pickCanonicalSchedule, decideCopy, copyConfirmText, classifyDrafts, shiftKey, daysBetween,
} from './scheduleCopy';
import { countPendingChanges } from './scheduleDiff';

const src = [
  { user_id: 'a', shift_date: '2026-11-16', day_of_week: 0, start_time: '09:00:00', end_time: '17:00:00', template_id: 't1', station_id: 'st1', is_time_off: false },
  { user_id: null, shift_date: '2026-11-22', day_of_week: 6, start_time: '16:00:00', end_time: '00:00:00', template_id: null, station_id: null },
];

describe('buildCopyRows', () => {
  it('shifts dates by the week offset and carries station_id (null = inherit)', () => {
    const rows = buildCopyRows(src, '2026-11-16', '2026-11-23');
    expect(rows[0]).toMatchObject({ shift_date: '2026-11-23', day_of_week: 0, station_id: 'st1', template_id: 't1', user_id: 'a' });
    expect(rows[1]).toMatchObject({ shift_date: '2026-11-29', day_of_week: 6, station_id: null, user_id: null, is_time_off: false });
  });
  it('is DST-proof across the November change', () => {
    expect(daysBetween('2026-10-26', '2026-11-02')).toBe(7);
    expect(buildCopyRows([{ ...src[0], shift_date: '2026-10-31' }], '2026-10-26', '2026-11-02')[0].shift_date).toBe('2026-11-07');
  });
});

describe('mergeSkipDupes', () => {
  const existing = [
    { user_id: 'a', shift_date: '2026-11-23', start_time: '09:00', end_time: '17:00' },
    { user_id: null, shift_date: '2026-11-29', start_time: '16:00:00', end_time: '00:00:00' },
  ];
  it('skips exact person+date+start+end dupes, including identical open slots', () => {
    const rows = buildCopyRows(src, '2026-11-16', '2026-11-23');
    const r = mergeSkipDupes(rows, existing);
    expect(r.skipped).toBe(2);
    expect(r.toAdd).toHaveLength(0);
  });
  it('keeps same-time shifts for a different person or date', () => {
    const rows = [
      { user_id: 'b', shift_date: '2026-11-23', start_time: '09:00', end_time: '17:00' },
      { user_id: 'a', shift_date: '2026-11-24', start_time: '09:00', end_time: '17:00' },
    ];
    expect(mergeSkipDupes(rows, existing).toAdd).toHaveLength(2);
  });
  it('counts per key: two source open slots vs one existing adds one', () => {
    const slot = { user_id: null, shift_date: '2026-11-29', start_time: '16:00', end_time: '00:00' };
    const r = mergeSkipDupes([slot, { ...slot }], existing);
    expect(r).toMatchObject({ skipped: 1 });
    expect(r.toAdd).toHaveLength(1);
  });
  it('station is not part of the key', () => {
    expect(shiftKey({ user_id: 'a', shift_date: 'd', start_time: '09:00:00', end_time: '10:00' })).toBe(shiftKey({ user_id: 'a', shift_date: 'd', start_time: '09:00', end_time: '10:00:00' }));
  });
});

describe('copy decision', () => {
  it('blocks a posted target with no popup, confirms when drafts exist, copies otherwise', () => {
    expect(decideCopy({ exists: true, isPublished: true, shiftCount: 0 })).toBe('blocked');
    expect(decideCopy({ exists: true, isPublished: true, shiftCount: 51 })).toBe('blocked');
    expect(decideCopy({ exists: true, isPublished: false, shiftCount: 3 })).toBe('confirm');
    expect(decideCopy({ exists: true, isPublished: false, shiftCount: 0 })).toBe('copy');
    expect(decideCopy({ exists: false, isPublished: false, shiftCount: 0 })).toBe('copy');
  });
  it('popup text explains what Replace would have done', () => {
    const t = copyConfirmText('Nov 23–Nov 29', 51);
    expect(t).toContain('already has 51 draft shifts');
    expect(t).toContain('would have deleted all 51 draft shifts in that week and copied this week on top');
    expect(copyConfirmText('x', 1)).toContain('1 draft shift.');
  });
});

describe('pickCanonicalSchedule', () => {
  it('published beats a fuller draft; else most shifts, then oldest', () => {
    expect(pickCanonicalSchedule([
      { id: 'draft', is_published: false, shift_count: 60, created_at: '2026-11-01' },
      { id: 'live', is_published: true, shift_count: 51, created_at: '2026-11-02' },
    ])?.id).toBe('live');
    expect(pickCanonicalSchedule([
      { id: 'small', is_published: false, shift_count: 1, created_at: '2026-11-01' },
      { id: 'big', is_published: false, shift_count: 9, created_at: '2026-11-03' },
      { id: 'big-old', is_published: false, shift_count: 9, created_at: '2026-11-02' },
    ])?.id).toBe('big-old');
    expect(pickCanonicalSchedule([])).toBeNull();
  });
});

describe('draft classification', () => {
  const snap = [
    { id: '1', user_id: 'a', start_time: '09:00', end_time: '17:00', shift_date: 'd', day_of_week: 0, station_id: 's1' },
    { id: '2', user_id: 'b', start_time: '09:00', end_time: '17:00', shift_date: 'd', day_of_week: 0, station_id: null },
  ];
  it('unpublished: every shift is a draft', () => {
    expect(classifyDrafts(false, snap, snap).total).toBe(2);
  });
  it('published: adds, modifies (station-only too) and snapshot deletes', () => {
    const cur = [
      { ...snap[0], station_id: 's2' },
      { id: '3', user_id: 'c', start_time: '09:00', end_time: '17:00', shift_date: 'd', day_of_week: 0, station_id: null },
    ];
    expect(classifyDrafts(true, snap, cur)).toEqual({ added: 1, modified: 1, deleted: 1, total: 3 });
    expect(classifyDrafts(true, snap, snap).total).toBe(0);
  });
  it('pending count includes a station-only edit, and ignores station when a side did not load it', () => {
    expect(countPendingChanges(snap, [{ ...snap[0], station_id: 's9' }, snap[1]])).toBe(1);
    const { station_id: _x, ...noStation } = snap[0];
    expect(countPendingChanges(snap, [noStation, snap[1]])).toBe(0);
  });
});
