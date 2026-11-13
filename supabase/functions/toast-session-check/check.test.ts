import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  chicagoYesterday,
  evaluateProbe,
  failDedupKey,
  failEmailHtml,
  probeWindowStart,
  shouldRunCheck,
  SUBJECT,
  TEST_SUBJECT,
  zoneParts,
} from "./check.ts";

function pt(isoLocal: string): Date {
  // isoLocal like "2026-11-13T05:15:00" interpreted as America/Los_Angeles.
  // Find the UTC instant whose PT wall time matches.
  const [d, t] = isoLocal.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [hh, mm, ss] = (t ?? "00:00:00").split(":").map(Number);
  // PT is UTC-8 in November (PST).
  return new Date(Date.UTC(y, mo - 1, da, hh + 8, mm, ss || 0));
}

Deno.test("shouldRunCheck is only 5:15–5:59 AM PT", () => {
  assertFalse(shouldRunCheck(pt("2026-11-13T05:14:00")));
  assert(shouldRunCheck(pt("2026-11-13T05:15:00")));
  assert(shouldRunCheck(pt("2026-11-13T05:59:00")));
  assertFalse(shouldRunCheck(pt("2026-11-13T06:00:00")));
  assertFalse(shouldRunCheck(pt("2026-11-13T07:18:00")));
  assertFalse(shouldRunCheck(pt("2026-11-13T15:00:00")));
});

Deno.test("probeWindowStart is 5:00 AM PT that morning", () => {
  const start = probeWindowStart(pt("2026-11-13T05:15:00"));
  const p = zoneParts("America/Los_Angeles", start);
  assertEquals(p.date, "2026-11-13");
  assertEquals(p.hour, 5);
  assertEquals(p.minute, 0);
});

Deno.test("chicagoYesterday at 5 AM PT is the previous Chicago calendar day", () => {
  // 5:00 AM PT = 7:00 AM CT on Nov 13 → yesterday is Nov 12.
  assertEquals(chicagoYesterday(pt("2026-11-13T05:15:00")), "2026-11-12");
});

Deno.test("pass: successful previous-day sales fetch after 5:00 AM PT, no failure", () => {
  const now = pt("2026-11-13T05:16:00");
  const fetched = pt("2026-11-13T05:03:00");
  const r = evaluateProbe({
    now,
    heartbeatAt: fetched,
    state: "stopped",
    message: "session_probe:ok net $4316.77 (13 checks)",
    yesterdaySalesFetchedAt: fetched,
  });
  assertEquals(r, { ok: true });
});

Deno.test("pass: data posted is enough even without a distinctive heartbeat", () => {
  const now = pt("2026-11-13T05:16:00");
  const r = evaluateProbe({
    now,
    heartbeatAt: null,
    state: null,
    message: null,
    yesterdaySalesFetchedAt: pt("2026-11-13T05:04:00"),
  });
  assertEquals(r, { ok: true });
});

Deno.test("fail: SESSION_EXPIRED after 5:00 AM PT is red, even if an old sales row exists", () => {
  const now = pt("2026-11-13T05:16:00");
  const r = evaluateProbe({
    now,
    heartbeatAt: pt("2026-11-13T05:02:00"),
    state: "error",
    message: "SESSION_EXPIRED saved Toast sign-in was rejected or missing. Sign in by hand (Sign In Once.command).",
    yesterdaySalesFetchedAt: pt("2026-11-12T21:00:00"), // previous evening, before today's window
  });
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.reason.includes("SESSION_EXPIRED"));
});

Deno.test("fail: no heartbeat and no new sales by 5:15 AM PT (dead mini)", () => {
  const now = pt("2026-11-13T05:16:00");
  const r = evaluateProbe({
    now,
    heartbeatAt: pt("2026-11-12T21:06:00"), // last night
    state: "stopped",
    message: "store closed for the day",
    yesterdaySalesFetchedAt: pt("2026-11-12T21:00:00"),
  });
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.reason.includes("did not run or report"));
});

Deno.test("fail: probe ran but posted no data", () => {
  const now = pt("2026-11-13T05:16:00");
  const r = evaluateProbe({
    now,
    heartbeatAt: pt("2026-11-13T05:04:00"),
    state: "error",
    message: "session_probe:no_data",
    yesterdaySalesFetchedAt: null,
  });
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.reason.includes("no data"));
});

Deno.test("fail email matches new-review style and TEST marking", () => {
  const html = failEmailHtml("SESSION_EXPIRED: the saved Toast sign-in was rejected or missing.", false);
  assert(html.includes("What failed:"));
  assert(html.includes("Run Sign In Once.command on the mini."));
  assertFalse(html.includes("TEST"));
  const testHtml = failEmailHtml("simulated", true);
  assert(testHtml.includes("<b>TEST</b>"));
  assertEquals(SUBJECT, "Hayward Toast check failed");
  assertEquals(TEST_SUBJECT, "TEST: Hayward Toast check failed");
  const now = pt("2026-11-13T05:16:00");
  assertEquals(failDedupKey(now, false), "hayward_toast_check_failed_2026-11-13");
  assertEquals(failDedupKey(now, true), "hayward_toast_check_failed_TEST_2026-11-13");
});
