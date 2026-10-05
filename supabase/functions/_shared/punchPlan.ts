// THE rules for Theo's clock in / clock out (build 6C). Pure: no database, no clock. Checked at the preview AND at the tap.
// "Clocked in" = the latest clock_in in the last 24 hours with no clock_out after it (the same test the database trigger uses),
// so a 6 PM clock-in can be clocked out at 1 AM.

export type Punch = { id: string; punch_type: string; punch_time: string; location_id?: string | null };
export type DayShift = { id: string; start_time: string; end_time: string };
export type PunchKind = "in" | "out";

const H = 3600_000;
const ms = (t: string) => new Date(t).getTime();

/** The open clock-in at `at` (ms), and the person's last punch after it. */
export function openClockIn(punches: Punch[], at: number): { clockIn: Punch; last: Punch } | null {
  const sorted = [...punches].filter((p) => ms(p.punch_time) <= at).sort((a, b) => ms(a.punch_time) - ms(b.punch_time));
  const ins = sorted.filter((p) => p.punch_type === "clock_in" && ms(p.punch_time) > at - 24 * H);
  for (let i = ins.length - 1; i >= 0; i--) {
    const ci = ins[i];
    const after = sorted.filter((p) => ms(p.punch_time) > ms(ci.punch_time));
    if (after.some((p) => p.punch_type === "clock_out")) return null; // the latest clock-in was closed
    return { clockIn: ci, last: after.length ? after[after.length - 1] : ci };
  }
  return null;
}

/** "8:30", "4", "4 pm", "16:00", "now"/empty -> minutes after midnight. Without am/pm, the closest one not after now. */
export function parseSaidTime(said: string | null | undefined, nowMin: number): number | null | "now" {
  const s = String(said ?? "").trim().toLowerCase();
  if (!s || /^(now|right now)$/.test(s)) return "now";
  if (s === "noon") return 720;
  if (s === "midnight") return 0;
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.[0];
  if (ap) { if (h > 12 || h === 0) return null; h = (h % 12) + (ap === "p" ? 12 : 0); return h * 60 + min; }
  if (h > 12 || h === 0) return h * 60 + min;
  const am = (h % 12) * 60 + min, pm = am + 720;
  const past = [am, pm].filter((x) => x <= nowMin);
  return past.length ? Math.max(...past) : am;
}

/** Local date + HH:MM in a time zone -> UTC ISO. */
export function zonedToUtc(date: string, minutes: number, tz: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  const off = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute")) - t;
  };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t).toISOString();
}

export const NO_SHIFT_FLAG = "No scheduled shift. Confirming also adds a placeholder shift to the schedule.";
export const AFTER_FACT_FLAG = "This is entered after the fact. It changes pay.";

export type PunchCheck =
  | { ok: false; reason: string }
  | { ok: true; flags: string[]; shift_id: string | null; open_clock_in: Punch | null };

/** The decision. `fmt` turns an ISO time into a store-local "Mon Oct 5, 6:00 PM". */
export function checkPunch(o: {
  kind: PunchKind; name: string; at: number; now: number; punches: Punch[]; shifts: DayShift[];
  atLocalMin: number; meeting: string | null; fmt: (iso: string) => string;
}): PunchCheck {
  const first = o.name.split(" ")[0];
  if (o.at > o.now + 60_000) return { ok: false, reason: `That time is in the future. ${o.kind === "in" ? "Clock-ins" : "Clock-outs"} can't be ahead of now.` };
  const open = openClockIn(o.punches, o.at);
  const flags: string[] = [];
  if (o.now - o.at > 10 * 60_000) flags.push(AFTER_FACT_FLAG);
  if (o.kind === "in") {
    if (open) return { ok: false, reason: `${first} is already clocked in, since ${o.fmt(open.clockIn.punch_time)}.` };
    // A clock-in before a later punch would rewrite history: refuse.
    if (o.punches.some((p) => ms(p.punch_time) > o.at)) return { ok: false, reason: `${first} has punches after that time. Use the Time Clock page for that.` };
    if (o.shifts.length === 0) flags.push(NO_SHIFT_FLAG);
    else {
      const near = Math.min(...o.shifts.map((s) => { const [h, m] = s.start_time.split(":").map(Number); return Math.abs(h * 60 + m - o.atLocalMin); }));
      if (near > 30) flags.push(`More than 30 minutes from ${first}'s scheduled start.`);
    }
    if (o.meeting) flags.push(`Meeting: ${o.meeting}. ${first} is an attendee.`);
    return { ok: true, flags, shift_id: o.shifts.length === 1 ? o.shifts[0].id : null, open_clock_in: null };
  }
  if (!open) return { ok: false, reason: `${first} isn't clocked in.` };
  if (open.last.punch_type === "break_start") return { ok: false, reason: `${first} is on a break. End it first.` };
  if (o.at <= ms(open.clockIn.punch_time)) return { ok: false, reason: `The clock-out has to be after ${first}'s clock-in at ${o.fmt(open.clockIn.punch_time)}.` };
  if (o.at < ms(open.last.punch_time)) return { ok: false, reason: `${first} has a punch after that time. Use the Time Clock page for that.` };
  if (o.at - ms(open.clockIn.punch_time) > 16 * H) flags.push("More than 16 hours after the clock-in.");
  return { ok: true, flags, shift_id: null, open_clock_in: open.clockIn }; // clock-out NEVER attaches a shift
}

/** Undo removes the placeholder shift only when every check passes. */
export function canRemovePlaceholder(o: { is_phantom: boolean; shift_created_at: string; punch_created_at: string; other_refs: number }): boolean {
  return o.is_phantom === true && Math.abs(ms(o.shift_created_at) - ms(o.punch_created_at)) <= 60_000 && o.other_refs === 0;
}
