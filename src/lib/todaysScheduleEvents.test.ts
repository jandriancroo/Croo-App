import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { mergeScheduleEvents, scheduleDayContext, selectTodaysScheduleEvents, type TodayEventRow } from './todaysScheduleEvents';
import { filterEventsByRole } from '@/utils/eventRoleFilter';

const options = { today: '2026-10-13', dayOfWeek: 1, locationId: 'hayward', scheduleId: 'week', canSeeOneOffs: true };
const row = (id: string, fields: Partial<TodayEventRow> = {}): TodayEventRow => ({
  id, event_name: id, event_time: '08:00:00', day_of_week: 1, days_of_week: null,
  event_date: '2026-10-13', schedule_id: 'week', location_id: 'hayward', is_recurring: false, is_daily_task: true, ...fields,
});
const template = (id: string, fields: Partial<TodayEventRow> = {}) => row(id, { schedule_id: null, event_date: null, is_recurring: true, ...fields });

describe('today schedule events', () => {
  it('uses store-local calendar day, Monday=0, and local week across UTC rollover', () => {
    expect(scheduleDayContext('America/Chicago', '2026-10-13')).toEqual({ today: '2026-10-13', dayOfWeek: 1, weekStart: '2026-10-12' });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T05:11:00Z'));
    expect(scheduleDayContext('America/Los_Angeles').today).toBe('2026-10-13');
    expect(scheduleDayContext('America/Chicago').today).toBe('2026-10-14');
    vi.useRealTimers();
  });
  it('shows Hayward Tuesday tasks once, excludes non-tasks and other dates/weeks, and sorts times', () => {
    const events = [row('H.S. Cross Country Order 4 PM', { event_time: '16:00:00' }),
      row('Put Away Order - Manion'), row('H.S. Cross Country Order 3 PM', { event_time: '15:00:00' }),
      row('Trivia', { is_daily_task: false }), row('BDAY', { is_daily_task: false }),
      row('LP Catering Order', { event_date: '2026-10-27', schedule_id: 'future-week' }),
      row('Wrong schedule', { schedule_id: 'wrong-week' })];
    expect(selectTodaysScheduleEvents([...events, events[0]], [], options).map(e => e.id)).toEqual([
      'Put Away Order - Manion', 'H.S. Cross Country Order 3 PM', 'H.S. Cross Country Order 4 PM',
    ]);
  });
  it('keeps recurring templates for today with days array preferred over fallback', () => {
    expect(selectTodaysScheduleEvents([], [template('array', { days_of_week: [1, 3], day_of_week: 0 }),
      template('fallback', { days_of_week: [] }), template('not-today', { days_of_week: [0] }),
      template('wrong-store', { location_id: 'other' }), template('linked', { schedule_id: 'other' }),
      template('not-recurring', { is_recurring: false })], options).map(e => e.id)).toEqual(['array', 'fallback']);
  });
  it('hides draft one-offs but preserves recurring tasks, even without a schedule', () => {
    expect(selectTodaysScheduleEvents([row('draft')], [template('recurring')], { ...options, canSeeOneOffs: false }).map(e => e.id)).toEqual(['recurring']);
    expect(selectTodaysScheduleEvents([row('draft')], [template('recurring')], { ...options, scheduleId: null }).map(e => e.id)).toEqual(['recurring']);
  });
  it('matches the schedule override deduplication without collapsing different times', () => {
    const override = row('override', { event_name: 'Order' });
    const recurring = template('template', { event_name: 'Order' });
    const later = template('later', { event_name: 'Order', event_time: '16:00:00' });
    expect(mergeScheduleEvents([override], [recurring, later]).map(e => e.id)).toEqual(['override', 'later']);
    expect(selectTodaysScheduleEvents([override], [recurring, later], options).map(e => e.id)).toEqual(['override', 'later']);
  });
  it('preserves role visibility after today selection', () => {
    const selected = selectTodaysScheduleEvents([{ ...row('restricted'), tagged_roles: ['manager'] }, { ...row('public'), tagged_roles: null }], [], options);
    expect(filterEventsByRole(selected, 'team_member').map(e => e.id)).toEqual(['public']);
    expect(filterEventsByRole(selected, 'manager')).toHaveLength(2);
  });
});