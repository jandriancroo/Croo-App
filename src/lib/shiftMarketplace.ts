// The Shift Marketplace's manager actions and their previews.
// Every save is ONE database call (an RPC that checks the caller and the shift, and writes in one transaction):
// approve_shift_offer, assign_shift_offer, deny_shift_offer_claim, undo_shift_offer.
// Migration: supabase/migrations/20261023033000_shift_marketplace_rpcs.sql
import { supabase } from '@/integrations/supabase/client';
import { getDisplayName } from '@/utils/displayName';
import { normalizeWeeklyAvailability, conflictingBlocks, DAY_KEYS_SUNDAY_FIRST } from '@/types/availability';
import { rankCover, fmtRange, type CoverInput, type CoverResult } from '../../supabase/functions/_shared/coverCandidates';
import { APP_ROLE_ORDER, APP_ROLE_NAMES } from '../../supabase/functions/_shared/appRoles';
import type { DayView, DayRow } from '@/components/schedule/DayRows';

export const MANAGER_PLUS_ROLES = ['manager', 'general_manager', 'admin', 'org_admin', 'brand_admin', 'super_admin'];
export const isManagerPlus = (role: string | null | undefined) => !!role && MANAGER_PLUS_ROLES.includes(role);
export const UNDO_MS = 10 * 60 * 1000;

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args).then((r: { error: any }) => { if (r.error) throw r.error; });
export const approveShiftOffer = (offerId: string, claimerId: string) => rpc('approve_shift_offer', { _offer_id: offerId, _claimer_id: claimerId });
export const assignShiftOffer = (offerId: string, userId: string) => rpc('assign_shift_offer', { _offer_id: offerId, _user_id: userId });
export const denyShiftOfferClaim = (offerId: string, claimerId: string) => rpc('deny_shift_offer_claim', { _offer_id: offerId, _claimer_id: claimerId });
export const undoShiftOffer = (offerId: string) => rpc('undo_shift_offer', { _offer_id: offerId });

const mins = (t: string) => { const [h, m] = String(t || '0:0').slice(0, 5).split(':').map(Number); return (h || 0) * 60 + (m || 0); };

export type OfferShift = { id: string; user_id: string; schedule_id: string; shift_date: string; start_time: string; end_time: string; location_id: string; position: string | null };
export type DayShiftRow = { id: string; user_id: string | null; start_time: string; end_time: string; name: string; position: string | null; is_time_off?: boolean | null };

/** Pure: the day as it will be. Owner's row is Removed, the new person's row is Covering (or New when they had nothing that day). */
export function buildOfferDayView(opts: { shift: OfferShift; dayShifts: DayShiftRow[]; ownerName: string; newPerson: { id: string; name: string }; title: string }): DayView {
  const { shift, newPerson } = opts;
  const rows: DayRow[] = [];
  const time = fmtRange(shift.start_time, shift.end_time);
  const others = opts.dayShifts.filter((d) => d.id !== shift.id && d.user_id && !d.is_time_off);
  const alreadyOn = others.some((d) => d.user_id === newPerson.id);
  for (const d of others) {
    rows.push({ id: d.id, name: d.name, position: d.position || 'Shift', time: fmtRange(d.start_time, d.end_time), start: mins(d.start_time), end: mins(d.end_time), kind: null });
  }
  rows.push({ id: `${shift.id}:owner`, name: opts.ownerName, position: shift.position || 'Shift', time, start: mins(shift.start_time), end: mins(shift.end_time), kind: 'removed' });
  rows.push({ id: `${shift.id}:new`, name: newPerson.name, position: shift.position || 'Shift', time, start: mins(shift.start_time), end: mins(shift.end_time), kind: alreadyOn ? 'new' : 'cover' });
  rows.sort((a, b) => a.start - b.start || (a.kind === 'removed' ? -1 : 0) - (b.kind === 'removed' ? -1 : 0) || a.name.localeCompare(b.name));
  return { date: shift.shift_date, title: opts.title, rows };
}

/** Pure: true when taking this shift puts the person on 6+ distinct days that week. */
export function wouldHitSixthDay(personId: string, shift: { id: string; shift_date: string }, weekShifts: { id: string; user_id: string | null; shift_date: string; is_time_off?: boolean | null }[]) {
  const days = new Set(weekShifts.filter((w) => w.user_id === personId && !w.is_time_off && w.id !== shift.id).map((w) => w.shift_date));
  days.add(shift.shift_date);
  return days.size >= 6;
}

/** Pure: how many distinct days the person works that week once they take this shift (6 = Sixth day, 7 = Seventh day). */
export function weekDaysAfterTaking(personId: string, shift: { id: string; shift_date: string }, weekShifts: { id: string; user_id: string | null; shift_date: string; is_time_off?: boolean | null }[]) {
  const days = new Set(weekShifts.filter((w) => w.user_id === personId && !w.is_time_off && w.id !== shift.id).map((w) => w.shift_date));
  days.add(shift.shift_date);
  return days.size;
}

/** Pure: the warning flags for one person. Warnings only; nothing is blocked. */
export function assignFlags(c: { dayCount: number; blocked: string | null }): string[] {
  const f: string[] = [];
  if (c.dayCount >= 7) f.push('Seventh day');
  else if (c.dayCount === 6) f.push('Sixth day');
  if (c.blocked) f.push('Unavailable');
  return f;
}

/** Pure: people who claimed come first (in claim order), then everyone else (in cover order). */
export function splitClaimersFirst<T extends { id: string }>(list: T[], claimerIds: string[]): { claimers: T[]; others: T[] } {
  const byId = new Map(list.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const claimers: T[] = [];
  for (const id of claimerIds) {
    const c = byId.get(id);
    if (c && !seen.has(id)) { claimers.push(c); seen.add(id); }
  }
  return { claimers, others: list.filter((c) => !seen.has(c.id)) };
}

/** The offered shift with its store. */
export async function loadOfferShift(shiftId: string): Promise<OfferShift> {
  const { data, error } = await supabase.from('scheduled_shifts')
    .select('id, user_id, schedule_id, shift_date, start_time, end_time, schedule:schedules!inner(location_id), template:shift_templates(position)')
    .eq('id', shiftId).single();
  if (error) throw error;
  const d: any = data;
  return { id: d.id, user_id: d.user_id, schedule_id: d.schedule_id, shift_date: d.shift_date, start_time: d.start_time, end_time: d.end_time, location_id: d.schedule?.location_id, position: d.template?.position ?? null };
}

/** Everyone working that day at that store (for the preview). */
export async function loadDayShifts(shift: OfferShift): Promise<DayShiftRow[]> {
  const { data, error } = await supabase.from('scheduled_shifts')
    .select('id, user_id, start_time, end_time, is_time_off, schedule:schedules!inner(location_id), template:shift_templates(position)')
    .eq('schedule.location_id', shift.location_id).eq('shift_date', shift.shift_date).not('user_id', 'is', null);
  if (error) throw error;
  const ids = [...new Set((data || []).map((r: any) => r.user_id as string))];
  const { data: profs } = ids.length ? await supabase.from('profiles').select('id, full_name, nickname').in('id', ids) : { data: [] as any[] };
  const nm = new Map((profs || []).map((p: any) => [p.id, getDisplayName(p.full_name, p.nickname)]));
  return (data || []).map((r: any) => ({ id: r.id, user_id: r.user_id, start_time: r.start_time, end_time: r.end_time, is_time_off: r.is_time_off, position: r.template?.position ?? null, name: nm.get(r.user_id) || 'Teammate' }));
}

export type AssignCandidate = { id: string; name: string; line: string; tag: string | null; sixthDay: boolean; dayCount: number; blocked: string | null; group: 'clear' | 'working' | 'blocked' };

/** Store crew ranked with the same cover check Theo uses (time off, availability, overlaps) plus a Sixth day flag. */
export async function loadAssignCandidates(shift: OfferShift): Promise<AssignCandidate[]> {
  const { data: ros } = await supabase.from('user_locations').select('user_id').eq('location_id', shift.location_id).eq('show_on_schedule', true);
  const ids = [...new Set((ros || []).map((r: any) => r.user_id as string))];
  if (!ids.length) return [];
  const [prof, roles, off, week, hrs] = await Promise.all([
    supabase.from('profiles').select('id, full_name, nickname, weekly_availability, is_active').in('id', ids),
    supabase.from('user_roles').select('user_id, role').in('user_id', [...ids, shift.user_id]),
    supabase.from('availability_requests').select('user_id, start_date, end_date, start_time, end_time, time_scope, status')
      .in('user_id', ids).in('status', ['pending', 'approved']).lte('start_date', shift.shift_date)
      .or(`end_date.gte.${shift.shift_date},end_date.is.null`),
    supabase.from('scheduled_shifts').select('id, user_id, shift_date, start_time, end_time, is_time_off').eq('schedule_id', shift.schedule_id),
    supabase.from('location_hours').select('day_of_week, open_time, close_time, is_closed').eq('location_id', shift.location_id),
  ]);
  const roleOf = new Map<string, string>();
  for (const r of (roles.data || []) as any[]) {
    const cur = roleOf.get(r.user_id);
    const i = APP_ROLE_ORDER.indexOf(r.role);
    if (i >= 0 && (cur === undefined || i < APP_ROLE_ORDER.indexOf(cur))) roleOf.set(r.user_id, r.role);
  }
  const hours: Record<string, { open: string; close: string }> = {};
  for (const row of (hrs.data || []) as any[]) {
    const key = DAY_KEYS_SUNDAY_FIRST[row.day_of_week];
    if (!key || row.is_closed || !row.open_time || !row.close_time) continue;
    hours[key] = { open: String(row.open_time).substring(0, 5), close: String(row.close_time).substring(0, 5) };
  }
  const people = ((prof.data || []) as any[]).filter((p) => p.is_active !== false)
    .map((p) => ({ id: p.id, name: getDisplayName(p.full_name, p.nickname), role: roleOf.get(p.id) || 'team_member', weekly_availability: p.weekly_availability ?? null }));
  const weekShifts = (week.data || []) as any[];
  const input: CoverInput = {
    shift: { id: shift.id, user_id: shift.user_id, shift_date: shift.shift_date, start_time: shift.start_time, end_time: shift.end_time },
    coveredRole: roleOf.get(shift.user_id) || 'team_member', people, timeOff: (off.data || []) as any[], weekShifts, hours,
    roleOrder: APP_ROLE_ORDER, roleNames: APP_ROLE_NAMES,
    avail: { normalizeWeekly: normalizeWeeklyAvailability as any, conflictingBlocks: conflictingBlocks as any },
  };
  return toAssignList(rankCover(input), shift, weekShifts);
}

/** Pure: flatten the ranked cover result into one list (clear, then working, then blocked). */
export function toAssignList(r: CoverResult, shift: { id: string; shift_date: string }, weekShifts: { id: string; user_id: string | null; shift_date: string; is_time_off?: boolean | null }[]): AssignCandidate[] {
  const six = (id: string) => wouldHitSixthDay(id, shift, weekShifts);
  const days = (id: string) => weekDaysAfterTaking(id, shift, weekShifts);
  return [
    ...r.clear.map((c) => ({ id: c.id, name: c.name, line: c.line, tag: c.tag, sixthDay: six(c.id), dayCount: days(c.id), blocked: null, group: 'clear' as const })),
    ...r.working.map((c) => ({ id: c.id, name: c.name, line: c.line, tag: c.tag, sixthDay: six(c.id), dayCount: days(c.id), blocked: null, group: 'working' as const })),
    ...r.blocked.map((b) => ({ id: b.id, name: b.name, line: b.reason, tag: null, sixthDay: six(b.id), dayCount: days(b.id), blocked: b.reason, group: 'blocked' as const })),
  ];
}
