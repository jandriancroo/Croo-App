/**
 * Pure helpers for Task History (no React, no db client, no external imports).
 * Byte-identical copy lives at supabase/functions/_shared/taskHistory/helpers.ts
 * (enforced by core.parity.test.ts). These mirror, unchanged in behavior:
 *  - src/utils/timezoneUtils.ts (offset, date, cutoff, business-day range, parse)
 *  - src/utils/dateUtils.ts (getDateDayOfWeekInTimezone)
 *  - src/utils/checklistVersions.ts (versionsLiveOnDay)
 *  - src/utils/checklistArchivePeriod.ts (getScorePeriodStart, isItemExpectedInPeriod)
 */

import { checklistScorePeriod, type ChecklistScheduleFields } from './schedule.ts';

export const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const DEFAULT_CUTOFF_HOUR = 5;
const HOURS_AFTER_CLOSE = 3;
const OVERNIGHT_CUTOFF_MAX = 12;

export const getTimezoneOffset = (
  timezone: string = DEFAULT_TIMEZONE,
  referenceDate: Date = new Date()
): string => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(referenceDate);
  const offsetPart = parts.find((p) => p.type === 'timeZoneName');
  if (offsetPart) {
    const match = offsetPart.value.match(/GMT([+-]\d{2}:\d{2})/);
    if (match) return match[1];
  }
  const staticOffsets: Record<string, string> = {
    'America/Los_Angeles': '-08:00',
    'America/Denver': '-07:00',
    'America/Phoenix': '-07:00',
    'America/Chicago': '-06:00',
    'America/New_York': '-05:00',
    'America/Anchorage': '-09:00',
    'Pacific/Honolulu': '-10:00',
  };
  return staticOffsets[timezone] || '-08:00';
};

export const getDateInTimezone = (date: Date, timezone: string = DEFAULT_TIMEZONE): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
};

/** Mon=0 .. Sun=6 for a given Date in the timezone. */
export const getDateDayOfWeekInTimezone = (date: Date, timezone: string = DEFAULT_TIMEZONE): number => {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const dayName = formatter.format(date);
  const dayMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  return dayMap[dayName] ?? 0;
};

export const calculateCutoffHour = (closeTime?: string | null): number => {
  if (!closeTime || typeof closeTime !== 'string') return DEFAULT_CUTOFF_HOUR;
  const [hours] = closeTime.split(':').map(Number);
  if (isNaN(hours)) return DEFAULT_CUTOFF_HOUR;
  return (hours + HOURS_AFTER_CLOSE) % 24;
};

export const parseDateStringInTimezone = (
  dateStr: string,
  timezone: string = DEFAULT_TIMEZONE
): Date => {
  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  const result = new Date(`${dateStr}T00:00:00${offset}`);
  const actualDate = getDateInTimezone(result, timezone);
  if (actualDate === dateStr) return result;
  const correctedOffset = getTimezoneOffset(timezone, result);
  return new Date(`${dateStr}T00:00:00${correctedOffset}`);
};

export const getBusinessDayRangeInTimezone = (
  dateStr: string,
  timezone: string = DEFAULT_TIMEZONE,
  closeTime?: string | null
): { start: Date; end: Date } => {
  const cutoffHour = calculateCutoffHour(closeTime);
  const isOvernightCutoff = cutoffHour > 0 && cutoffHour < OVERNIGHT_CUTOFF_MAX;
  const startHour = isOvernightCutoff ? cutoffHour : 0;
  const startHourStr = startHour.toString().padStart(2, '0');

  const referenceDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getTimezoneOffset(timezone, referenceDate);
  const start = new Date(`${dateStr}T${startHourStr}:00:00${offset}`);

  const nextDay = new Date(referenceDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDateStr = getDateInTimezone(nextDay, timezone);
  const nextOffset = getTimezoneOffset(timezone, nextDay);
  const end = new Date(`${nextDateStr}T${startHourStr}:00:00${nextOffset}`);
  return { start, end };
};

// ── Archive-aware expected items ──
export const isItemExpectedInPeriod = (
  item: { deleted_at?: string | null },
  periodStart: Date | null | undefined
): boolean => {
  if (!item.deleted_at) return true;
  if (!periodStart) return true;
  return new Date(item.deleted_at).getTime() >= periodStart.getTime();
};

export const getWeekStartDateStr = (dateStr: string, dayOfWeekMon0: number): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const anchor = new Date(y, m - 1, d, 12, 0, 0);
  anchor.setDate(anchor.getDate() - ((dayOfWeekMon0 + 7) % 7));
  const mm = String(anchor.getMonth() + 1).padStart(2, '0');
  const dd = String(anchor.getDate()).padStart(2, '0');
  return `${anchor.getFullYear()}-${mm}-${dd}`;
};

export const getScorePeriodStart = (args: {
  templateType?: string | null;
  frequency?: string | null;
  businessDateStr: string;
  dayOfWeekMon0: number;
  timezone?: string;
  closeTime?: string | null;
  /** The checklist row — when given, its schedule decides the period (week/month/quarter). */
  schedule?: ChecklistScheduleFields | null;
}): Date => {
  const timezone = args.timezone ?? DEFAULT_TIMEZONE;
  if (args.schedule && args.templateType !== 'dynamic') {
    const p = checklistScorePeriod({ ...args.schedule, template_type: args.templateType ?? args.schedule.template_type }, args.businessDateStr);
    if (p.kind !== 'day') return parseDateStringInTimezone(p.start, timezone);
    return getBusinessDayRangeInTimezone(args.businessDateStr, timezone, args.closeTime).start;
  }
  if (args.frequency === 'monthly') {
    const [y, m] = args.businessDateStr.split('-');
    return parseDateStringInTimezone(`${y}-${m}-01`, timezone);
  }
  if (args.templateType === 'dynamic') {
    const weekStartStr = getWeekStartDateStr(args.businessDateStr, args.dayOfWeekMon0);
    return getBusinessDayRangeInTimezone(weekStartStr, timezone, args.closeTime).start;
  }
  return getBusinessDayRangeInTimezone(args.businessDateStr, timezone, args.closeTime).start;
};

// ── Checklist versions ──
export interface VersionedChecklist {
  id: string;
  is_active?: boolean | null;
  family_id?: string | null;
  replaces_checklist_id?: string | null;
  superseded_at?: string | null;
}

const isPendingDraft = (c: VersionedChecklist): boolean =>
  !c.is_active && !c.superseded_at && !!c.replaces_checklist_id;

const wasLiveDuringPeriod = (c: VersionedChecklist, periodStart: Date): boolean => {
  if (isPendingDraft(c)) return false;
  if (c.superseded_at) return new Date(c.superseded_at).getTime() >= periodStart.getTime();
  return !!c.is_active;
};

export const versionsLiveOnDay = <T extends VersionedChecklist>(
  checklists: T[],
  dayStart: Date
): T[] => {
  const byFamily = new Map<string, T[]>();
  for (const c of checklists) {
    if (isPendingDraft(c)) continue;
    const key = c.family_id || c.id;
    const arr = byFamily.get(key);
    if (arr) arr.push(c);
    else byFamily.set(key, [c]);
  }
  const dayMs = dayStart.getTime();
  const picked: T[] = [];
  for (const versions of byFamily.values()) {
    if (versions.length === 1) {
      if (wasLiveDuringPeriod(versions[0], dayStart)) picked.push(versions[0]);
      continue;
    }
    const sorted = [...versions].sort((a, b) => {
      const av = a.superseded_at ? new Date(a.superseded_at).getTime() : Infinity;
      const bv = b.superseded_at ? new Date(b.superseded_at).getTime() : Infinity;
      return av - bv;
    });
    const hit = sorted.find((v) =>
      v.superseded_at ? new Date(v.superseded_at).getTime() > dayMs : !!v.is_active
    );
    if (hit) picked.push(hit);
  }
  return picked;
};
