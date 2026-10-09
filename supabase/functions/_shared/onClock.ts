// The ONE "who is clocked in at this store right now" read (Quick Nudge and anything else).
// Read-only. Branches on labor_source_for(location):
//   'toast'  → open, paired toast_shifts (Toast owns the punches; croo_user_id is the pairing)
//   anything else (punch_clock, …) → time_punches via the pure onClockIds rule
import { onClockIds } from "./nudgePlan.ts";

const DAY_MS = 24 * 3600_000;

export type ToastShiftRow = { croo_user_id: string | null; in_time: string | null; out_time: string | null };

/** Pure: open (no out_time), paired (croo_user_id) Toast shifts that started within 24h. */
export function toastOnClockIds(rows: ToastShiftRow[], now: number): string[] {
  const ids = new Set<string>();
  for (const r of rows || []) {
    if (!r?.croo_user_id || r.out_time) continue;
    const t = r.in_time ? new Date(r.in_time).getTime() : NaN;
    if (!Number.isFinite(t) || t > now || now - t > DAY_MS) continue;
    ids.add(r.croo_user_id);
  }
  return [...ids];
}

export async function clockedInUserIds(admin: any, locationId: string, now: number = Date.now()): Promise<string[]> {
  const since = new Date(now - DAY_MS).toISOString();
  const { data: source } = await admin.rpc("labor_source_for", { _location_id: locationId });
  if (source === "toast") {
    const { data, error } = await admin.from("toast_shifts")
      .select("croo_user_id, in_time, out_time")
      .eq("location_id", locationId).is("out_time", null).not("croo_user_id", "is", null).gte("in_time", since);
    if (error) throw new Error(error.message);
    return toastOnClockIds(data || [], now);
  }
  const { data: punches, error } = await admin.from("time_punches")
    .select("user_id, id, punch_type, punch_time, location_id")
    .eq("location_id", locationId).gte("punch_time", since).order("punch_time");
  if (error) throw new Error(error.message);
  const byUser: Record<string, any[]> = {};
  for (const p of punches || []) (byUser[p.user_id] ||= []).push(p);
  return onClockIds(byUser, now);
}
