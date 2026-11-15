// Pure 5:00 AM PT Hayward Toast session-check logic. No I/O.
// The mini runner probes at 5:00 AM PT; this decides pass/fail at/after 5:15 AM PT
// so a dead mini (no heartbeat, no sales post) still emails Jordan.

export const HAYWARD_LOCATION_ID = "0d1477e5-791d-42f4-9245-ad8b2e75c41c";
export const TO_ADDRESS = "jordan@croohq.com";
export const FROM_ADDRESS = "CrooHQ <hello@croohq.email>";
export const SUBJECT = "Hayward Toast check failed";
export const TEST_SUBJECT = "TEST: Hayward Toast check failed";
export const SOURCE = "hayward_toast_session_check";
export const STORE_TZ = "America/Chicago";
export const CHECK_TZ = "America/Los_Angeles";

const PROBE_START_MIN = 5 * 60; // 5:00 AM PT
const DEADLINE_MIN = 5 * 60 + 15; // 5:15 AM PT
const WINDOW_END_MIN = 6 * 60; // stop considering the daily window at 6:00 AM PT

export type ZoneParts = { date: string; hour: number; minute: number; minOfDay: number };

export function zoneParts(tz: string, at: Date): ZoneParts {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const hour = parseInt(p.hour === "24" ? "00" : p.hour, 10);
  const minute = parseInt(p.minute, 10);
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute, minOfDay: hour * 60 + minute };
}

export function shiftYmd(ymd: string, days: number): string {
  const t = new Date(`${ymd}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function chicagoYesterday(at: Date): string {
  return shiftYmd(zoneParts(STORE_TZ, at).date, -1);
}

/** Today's 5:00 AM America/Los_Angeles as an absolute Date. */
export function probeWindowStart(at: Date): Date {
  const pt = zoneParts(CHECK_TZ, at);
  // Walk back at most 30 hours to the instant whose PT clock is 5:00 on pt.date.
  for (let ms = at.getTime(); ms > at.getTime() - 36 * 3600 * 1000; ms -= 60 * 1000) {
    const d = new Date(ms);
    const p = zoneParts(CHECK_TZ, d);
    if (p.date === pt.date && p.hour === 5 && p.minute === 0) return d;
  }
  // Fallback: construct from a PT ISO-like guess (should not happen).
  return at;
}

/** Cron/edge guard: 5:15 AM–5:59 AM PT only (DST-safe). */
export function shouldRunCheck(at: Date): boolean {
  const min = zoneParts(CHECK_TZ, at).minOfDay;
  return min >= DEADLINE_MIN && min < WINDOW_END_MIN;
}

export type ProbeInput = {
  now: Date;
  heartbeatAt: Date | null;
  state: string | null;
  message: string | null;
  yesterdaySalesFetchedAt: Date | null;
};

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: string };

const EXPIRED = /SESSION_EXPIRED|Sign in by hand/i;

export function evaluateProbe(i: ProbeInput): ProbeResult {
  const start = probeWindowStart(i.now);
  const hbInWindow = !!(i.heartbeatAt && i.heartbeatAt.getTime() >= start.getTime());
  const dataInWindow = !!(i.yesterdaySalesFetchedAt && i.yesterdaySalesFetchedAt.getTime() >= start.getTime());
  const msg = i.message ?? "";

  if (hbInWindow && EXPIRED.test(msg)) {
    return {
      ok: false,
      reason: "SESSION_EXPIRED: the saved Toast sign-in was rejected or missing.",
    };
  }
  if (dataInWindow) return { ok: true };
  if (hbInWindow) {
    return {
      ok: false,
      reason: "The morning Toast check ran but returned no data.",
    };
  }
  return {
    ok: false,
    reason: "The Hayward mini runner did not run or report by 5:15 AM PT.",
  };
}

export function escapeEmailHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function failEmailHtml(reason: string, test = false): string {
  const lead = test
    ? "<p><b>TEST</b> — this is a simulated failure, not a real outage.</p>"
    : "";
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
    lead +
    "<p>The 5:00 AM PT Hayward Toast session check failed.</p>" +
    `<p><b>What failed:</b> ${escapeEmailHtml(reason)}</p>` +
    "<p>Run Sign In Once.command on the mini.</p>" +
    "</div>"
  );
}

export function failDedupKey(at: Date, test = false): string {
  const day = zoneParts(CHECK_TZ, at).date;
  return test
    ? `hayward_toast_check_failed_TEST_${day}`
    : `hayward_toast_check_failed_${day}`;
}
