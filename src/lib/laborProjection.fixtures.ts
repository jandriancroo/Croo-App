// Shared inputs for the pace parity test (app computePace vs server sales_pace_today)
// and the per-shift rules of get_labor_projection. Used by
// src/lib/laborProjection.test.ts (app side) and scripts/check-labor-projection-sql.ts (server side).
const hourly = [
  { hour: '11:00', sales: 120, projected: 100 },
  { hour: '12:00', sales: 240, projected: 200 },
  { hour: '13:00', sales: 180, projected: 150 },
  { hour: '14:00', sales: 0, projected: 120 },
  { hour: '17:00', sales: 0, projected: 300 },
];
const dinner = [
  { hour: 11, sales: 100, projected: 100 },
  { hour: '12', sales: '90', projected: '100' },
  { hour: '13:00', sales: 110, projected: 100 },
  { hour: '15:00', sales: 150, projected: 200 },
  { hour: '16:00', sales: 180, projected: 200 },
  { hour: '17:00', sales: 220, projected: 200 },
  { hour: '18:00', sales: 50, projected: 250 },
  { hour: '19:00', sales: 0, projected: 250 },
];
const NOW = '2026-10-09T21:10:00Z';

export interface PaceFixture {
  name: string;
  hourly: unknown;
  net_sales: number;
  stored: number | null;
  stored_at: string | null;
  h: number;
  m: number;
  now: string;
}

export const paceFixtures: PaceFixture[] = [
  { name: 'lunch ahead, boost', hourly, net_sales: 540, stored: null, stored_at: null, h: 14, m: 10, now: NOW },
  { name: 'fresh stored pace wins', hourly, net_sales: 540, stored: 1500, stored_at: '2026-10-09T21:00:00Z', h: 14, m: 10, now: NOW },
  { name: 'stale stored pace ignored', hourly, net_sales: 540, stored: 1500, stored_at: '2026-10-09T20:40:00Z', h: 14, m: 10, now: NOW },
  { name: 'current hour past :30', hourly, net_sales: 540, stored: null, stored_at: null, h: 14, m: 45, now: NOW },
  { name: 'dinner points, behind', hourly: dinner, net_sales: 900, stored: null, stored_at: null, h: 18, m: 40, now: NOW },
  { name: 'dinner hour uses lunch carry', hourly: dinner, net_sales: 300, stored: null, stored_at: null, h: 15, m: 5, now: NOW },
  { name: 'too few points, factor 1', hourly: hourly.slice(0, 2), net_sales: 360, stored: null, stored_at: null, h: 13, m: 0, now: NOW },
  { name: 'no hourly data', hourly: [], net_sales: 100, stored: null, stored_at: null, h: 12, m: 0, now: NOW },
];

/** Per-shift rules (server _lp_shift_eval). Times are UTC. */
export const shiftFixtures = [
  { name: 'no-show still counted in full (late_not_in)', s: '2026-10-20T17:00:00Z', e: '2026-10-20T23:00:00Z', npairs: 0, open: null, first_in: null, last_out: null, now: '2026-10-20T19:00:00Z', src: 'punch_clock', so: false, rem_h: 6, state: 'late_not_in' },
  { name: 'not started yet: full shift', s: '2026-10-20T22:00:00Z', e: '2026-10-21T02:00:00Z', npairs: 0, open: null, first_in: null, last_out: null, now: '2026-10-20T19:00:00Z', src: 'punch_clock', so: false, rem_h: 4, state: 'not_started' },
  { name: 'late in: now → scheduled end', s: '2026-10-20T17:00:00Z', e: '2026-10-20T23:00:00Z', npairs: 1, open: true, first_in: '2026-10-20T17:20:00Z', last_out: null, now: '2026-10-20T19:00:00Z', src: 'punch_clock', so: false, rem_h: 4, state: 'working', late: 20 },
  { name: 'past scheduled end: over_schedule, nothing more', s: '2026-10-20T17:00:00Z', e: '2026-10-20T19:00:00Z', npairs: 1, open: true, first_in: '2026-10-20T17:00:00Z', last_out: null, now: '2026-10-20T19:30:00Z', src: 'punch_clock', so: false, rem_h: 0, state: 'over_schedule' },
  { name: 'left early: done, early minutes', s: '2026-10-20T17:00:00Z', e: '2026-10-20T23:00:00Z', npairs: 1, open: false, first_in: '2026-10-20T17:00:00Z', last_out: '2026-10-20T22:15:00Z', now: '2026-10-20T23:30:00Z', src: 'punch_clock', so: false, rem_h: 0, state: 'done', early: 45 },
  { name: 'split shift: second part still scheduled', s: '2026-10-21T00:00:00Z', e: '2026-10-21T03:00:00Z', npairs: 0, open: null, first_in: null, last_out: null, now: '2026-10-20T21:00:00Z', src: 'punch_clock', so: false, rem_h: 3, state: 'not_started' },
  { name: 'Qu store: only rest of shift from now', s: '2026-10-20T17:00:00Z', e: '2026-10-20T23:00:00Z', npairs: 0, open: null, first_in: null, last_out: null, now: '2026-10-20T19:00:00Z', src: 'qubeyond', so: false, rem_h: 4, state: 'working' },
  { name: 'stale sync: schedule_only full shift', s: '2026-10-20T17:00:00Z', e: '2026-10-20T23:00:00Z', npairs: 1, open: true, first_in: '2026-10-20T17:00:00Z', last_out: null, now: '2026-10-20T19:00:00Z', src: 'toast', so: true, rem_h: 6, state: 'scheduled' },
];
