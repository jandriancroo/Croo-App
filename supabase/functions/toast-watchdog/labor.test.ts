import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { laborStep } from "./labor.ts";

const now = new Date("2026-11-02T18:00:00Z");
const base = { locationId: "L1", storeName: "Hayward", now, minutesIntoWindow: 300, since: "8:03 AM" };
const mins = (m: number) => new Date(now.getTime() - m * 60000);

Deno.test("labor stale, sales fresh: one alert, stage 1, restart wording only when dispatched", () => {
  const a = laborStep({ ...base, laborAt: mins(120), stage: 0, dispatchResult: "dispatched" });
  assertEquals(a.nextStage, 1);
  assertEquals(a.alert?.body.endsWith("Restarting the robot."), true);
  const b = laborStep({ ...base, laborAt: mins(120), stage: 0, dispatchResult: null });
  assertEquals(b.alert?.body.endsWith("A person may need to sign the robot back in."), true);
  const c = laborStep({ ...base, laborAt: mins(120), stage: 0, dispatchResult: "no_github_key" });
  assertEquals(c.alert?.body.endsWith("A person may need to sign the robot back in."), true);
});

Deno.test("second run while still stale: no new alert", () => {
  const r = laborStep({ ...base, laborAt: mins(125), stage: 1, dispatchResult: null });
  assertEquals(r.alert, null);
  assertEquals(r.nextStage, 1);
});

Deno.test("labor fresh again resets stage; a later sign-out alerts again with a new key", () => {
  const fresh = laborStep({ ...base, laborAt: mins(2), stage: 1, dispatchResult: null });
  assertEquals(fresh.nextStage, 0);
  assertEquals(fresh.alert, null);
  const later = laborStep({ ...base, laborAt: mins(40), stage: 0, dispatchResult: null });
  const first = laborStep({ ...base, laborAt: mins(120), stage: 0, dispatchResult: null });
  assertEquals(later.nextStage, 1);
  assertEquals(later.alert!.dedupKey === first.alert!.dedupKey, false);
});

Deno.test("early in the window: no alert yet", () => {
  const r = laborStep({ ...base, laborAt: null, minutesIntoWindow: 20, stage: 0, dispatchResult: null });
  assertEquals(r.alert, null);
});
