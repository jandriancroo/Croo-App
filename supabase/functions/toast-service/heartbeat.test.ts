import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { heartbeatRow } from "./heartbeat.ts";

Deno.test("polling heartbeat never resets alert ladders", () => {
  const { row } = heartbeatRow("L1", { alert_stage: 1, labor_alert_stage: 1 }, { state: "polling" }, "2026-11-02", "2026-11-02T18:00:00Z");
  assertEquals("alert_stage" in row, false);
  assertEquals("labor_alert_stage" in row, false);
  assertEquals(row.state, "polling");
});

Deno.test("login cap unchanged", () => {
  const r = heartbeatRow("L1", { full_logins_date: "2026-11-02", full_logins_count: 4 }, { state: "signing_in", fullLogin: true }, "2026-11-02", "x");
  assertEquals(r.capped, true);
  assertEquals(r.row.state, "login_capped");
});
