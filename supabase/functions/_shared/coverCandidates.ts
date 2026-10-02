// THE cover check: who can take a shift, in what order, and why others can't.
// One function used by Theo's candidate list, his preview check, and the re-check at the Confirm tap.
// Pure: no database. The availability normalizer and role order are passed in so tests run the
// locked app originals and the server runs its checked mirrors.

export type CoverShift = { id: string; user_id: string; shift_date: string; start_time: string; end_time: string };
export type CoverPerson = { id: string; name: string; role: string | null; weekly_availability: any };
export type CoverTimeOff = { user_id: string; start_date: string; end_date: string | null; start_time: string | null; end_time: string | null; time_scope: string; status: string };
export type CoverWeekShift = { id: string; user_id: string | null; shift_date: string; start_time: string; end_time: string; is_time_off?: boolean | null };
export type DayAvail = { available: boolean; blocks?: { start: string; end: string }[] };
export type AvailTools = {
  normalizeWeekly: (raw: any, hours?: any) => Record<string, DayAvail> | null;
  conflictingBlocks: (day: DayAvail | null | undefined, s: string, e: string) => { start: string; end: string }[];
};
export type CoverInput = {
  shift: CoverShift;
  coveredRole: string | null;
  people: CoverPerson[];          // active crew at this store (the covered person is skipped)
  timeOff: CoverTimeOff[];
  weekShifts: CoverWeekShift[];   // every shift on that week
  hours?: Record<string, { open: string; close: string }>;
  roleOrder: string[];            // highest -> lowest (the app's list)
  roleNames: Record<string, string>;
  avail: AvailTools;
};
export type FailKind = 'time_off' | 'unavailable' | 'working_then';
export type CoverCandidate = { id: string; name: string; group: 'clear' | 'working'; tag: string | null; weekHours: number; line: string; sameDay: string[] };
export type CoverBlocked = { id: string; name: string; kind: FailKind; reason: string };
export type CoverResult = { clear: CoverCandidate[]; working: CoverCandidate[]; blocked: CoverBlocked[]; blockedSummary: string | null };

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mins = (t: string) => { const [h, m] = (t || '0:0').slice(0, 5).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** [start, end) in minutes; overnight shifts run past midnight. */
const span = (s: string, e: string): [number, number] => { const a = mins(s); let b = mins(e); if (b <= a) b += 1440; return [a, b]; };
const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
export const fmtTime = (t: string) => {
  const m = mins(t) % 1440; const h = Math.floor(m / 60); const mm = m % 60;
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const fmtRange = (s: string, e: string) => `${fmtTime(s)} – ${fmtTime(e)}`;
export const weekdayOf = (date: string) => DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()];
const hoursOf = (s: { start_time: string; end_time: string }) => { const [a, b] = span(s.start_time, s.end_time); return (b - a) / 60; };
const roundH = (n: number) => Math.round(n * 2) / 2;

/** Flag (never a hurdle) when the person needing cover outranks the candidate. */
export function roleTag(covered: string | null, candidate: string | null, order: string[], names: Record<string, string>): string | null {
  if (!covered) return null;
  const rc = order.indexOf(covered);
  const rk = order.indexOf(candidate || 'team_member');
  if (rc < 0 || rk < 0 || rc >= rk) return null;
  if (covered === 'shift_manager' && candidate === 'shift_manager_in_training') return 'Shift manager in training';
  const n = (names[covered] || covered).toLowerCase();
  return `Not ${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`;
}

function blockPhrase(b: { start: string; end: string }, hours?: { open: string; close: string }) {
  const open = hours?.open ? mins(hours.open) : 6 * 60;
  const close = hours?.close ? mins(hours.close) : 23 * 60;
  if (mins(b.end) >= close || mins(b.end) >= 23 * 60) return `after ${fmtTime(b.start)}`;
  if (mins(b.start) <= open) return `before ${fmtTime(b.end)}`;
  return `${fmtTime(b.start)} – ${fmtTime(b.end)}`;
}

/** Check one person against the three hurdles. null = passes. */
export function hurdleFor(person: CoverPerson, input: CoverInput): CoverBlocked | null {
  const { shift } = input;
  const first = person.name.split(' ')[0];
  const day = weekdayOf(shift.shift_date);
  const dayLabel = cap(day);
  const sh = span(shift.start_time, shift.end_time);

  // 1. Time off that day, pending or approved.
  for (const t of input.timeOff) {
    if (t.user_id !== person.id || !['pending', 'approved'].includes(t.status)) continue;
    const end = t.end_date || t.start_date;
    if (shift.shift_date < t.start_date || shift.shift_date > end) continue;
    const word = t.status === 'approved' ? 'approved time off' : 'time off requested';
    if (t.time_scope === 'partial_day') {
      if (!t.start_time || !t.end_time || !overlaps(sh, span(t.start_time, t.end_time))) continue;
      return { id: person.id, name: person.name, kind: 'time_off', reason: `${first} has ${word} ${dayLabel} ${fmtRange(t.start_time, t.end_time)}` };
    }
    return { id: person.id, name: person.name, kind: 'time_off', reason: `${first} has ${word} ${dayLabel}` };
  }

  // 2. Weekly availability (always read through the normalizer). Nothing on file = available.
  const week = input.avail.normalizeWeekly(person.weekly_availability, input.hours);
  const d = week?.[day];
  if (d) {
    if (d.available === false) return { id: person.id, name: person.name, kind: 'unavailable', reason: `${first} isn't available ${dayLabel}s` };
    const endForBlocks = sh[1] >= 1440 ? '24:00' : shift.end_time;
    const hit = input.avail.conflictingBlocks(d, shift.start_time, endForBlocks);
    if (hit.length) return { id: person.id, name: person.name, kind: 'unavailable', reason: `${first} can't work ${dayLabel}s ${blockPhrase(hit[0], input.hours?.[day])}` };
  }

  // 3. Already scheduled during any part of the shift.
  const clash = input.weekShifts.find((w) => w.user_id === person.id && w.id !== shift.id && !w.is_time_off && w.shift_date === shift.shift_date && overlaps(sh, span(w.start_time, w.end_time)));
  if (clash) return { id: person.id, name: person.name, kind: 'working_then', reason: `${first} is already working ${fmtRange(clash.start_time, clash.end_time)} that day` };
  return null;
}

export function candidateFor(person: CoverPerson, input: CoverInput): CoverCandidate {
  const { shift } = input;
  const mine = input.weekShifts.filter((w) => w.user_id === person.id && !w.is_time_off && w.id !== shift.id);
  const weekHours = roundH(mine.reduce((n, w) => n + hoursOf(w), 0));
  const sameDay = mine.filter((w) => w.shift_date === shift.shift_date).sort((a, b) => mins(a.start_time) - mins(b.start_time)).map((w) => fmtRange(w.start_time, w.end_time));
  const first = person.name.split(' ')[0];
  const group = sameDay.length ? 'working' : 'clear';
  const line = group === 'working'
    ? `${first} already scheduled ${sameDay.join(', ')}`
    : `Off ${cap(weekdayOf(shift.shift_date))} · ${weekHours} hrs this week`;
  return { id: person.id, name: person.name, group, tag: roleTag(input.coveredRole, person.role, input.roleOrder, input.roleNames), weekHours, line, sameDay };
}

const sortGroup = (a: CoverCandidate, b: CoverCandidate) =>
  (a.tag ? 1 : 0) - (b.tag ? 1 : 0) || a.weekHours - b.weekHours || a.name.localeCompare(b.name);

export function summarizeBlocked(blocked: CoverBlocked[], shiftDate: string) {
  if (!blocked.length) return null;
  const kinds = [...new Set(blocked.map((b) => b.kind))];
  const words = kinds.map((k) => (k === 'time_off' ? 'time off' : k === 'unavailable' ? `not available ${cap(weekdayOf(shiftDate))}s` : 'working then'));
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')}, or ${words[words.length - 1]}` : words[0];
  return `${blocked.length} ${blocked.length === 1 ? 'other' : 'others'} can't: ${list}`;
}

/** The ranked list for one shift. */
export function rankCover(input: CoverInput): CoverResult {
  const clear: CoverCandidate[] = [];
  const working: CoverCandidate[] = [];
  const blocked: CoverBlocked[] = [];
  for (const p of input.people) {
    if (p.id === input.shift.user_id) continue;
    const fail = hurdleFor(p, input);
    if (fail) { blocked.push(fail); continue; }
    const c = candidateFor(p, input);
    (c.group === 'clear' ? clear : working).push(c);
  }
  clear.sort(sortGroup);
  working.sort(sortGroup);
  return { clear, working, blocked, blockedSummary: summarizeBlocked(blocked, input.shift.shift_date) };
}
