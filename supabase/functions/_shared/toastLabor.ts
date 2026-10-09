// Pure Toast labor helpers (toast-sync + tests).

/** Store-local minutes past midnight for an instant, or null. */
export function localMinutesOfDay(iso: string | null | undefined, tz: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "", 10);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return (h === 24 ? 0 : h) * 60 + m;
  } catch {
    return null;
  }
}

/** Minutes late (only when more than 5 over the scheduled "HH:mm[:ss]" start), else null. */
export function lateMinutes(inIso: string, scheduledStart: string | null | undefined, tz: string): number | null {
  const inMin = localMinutesOfDay(inIso, tz);
  if (inMin == null || !scheduledStart) return null;
  const sh = parseInt(String(scheduledStart).slice(0, 2), 10);
  const sm = parseInt(String(scheduledStart).slice(3, 5), 10);
  if (!Number.isFinite(sh) || !Number.isFinite(sm)) return null;
  const late = inMin - (sh * 60 + sm);
  return late > 5 ? late : null;
}

/** Regular hours = total − overtime − double time, never below zero (2 decimals). */
export function regularHours(laborHours: number, overtimeHours: number, doubleTimeHours: number): number {
  return Math.round(Math.max(0, (laborHours || 0) - (overtimeHours || 0) - (doubleTimeHours || 0)) * 100) / 100;
}

/** End time for an open shift: now for today; the business-day end for past dates. */
export function openShiftEndMs(isToday: boolean, dayEndIso: string | null, nowMs = Date.now()): number {
  if (isToday || !dayEndIso) return nowMs;
  const end = new Date(dayEndIso).getTime();
  return Number.isNaN(end) ? nowMs : Math.min(end, nowMs);
}
