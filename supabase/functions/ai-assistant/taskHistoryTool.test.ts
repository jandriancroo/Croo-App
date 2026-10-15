import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveDates, runQueryTaskHistory } from "./taskHistoryTool.ts";

function fakeDb() {
  const tables: string[] = [];
  return {
    tables,
    from(table: string) {
      tables.push(table);
      const ops: any[] = [];
      const q: any = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === "then") return (res: any) => res(resolve(table, ops));
          return (...a: any[]) => { ops.push([prop, a]); return q; };
        },
      });
      return q;
    },
  };
}
function resolve(table: string, ops: any[]) {
  const isAlarmQ = ops.some(([m, a]) => m === "eq" && a[0] === "task_style");
  switch (table) {
    case "checklists": return { data: [
      { id: "A", title: "Opening Checklist", template_type: "standard", frequency: "daily", is_active: true, due_by_time: null,
        checklist_items: [{ id: "a1", item_type: "checkbox" }, { id: "a2", item_type: "checkbox" }] },
      { id: "B", title: "De-Ice Machine", template_type: "standard", frequency: "daily", is_active: true, due_by_time: null,
        checklist_items: [{ id: "b1", item_type: "checkbox" }] },
    ] };
    case "checklist_responses": return { data: [
      { item_id: "a1", submission_id: "s1", completed_by: "u1", created_at: "2026-10-12T16:00:00Z", checklist_submissions: { id: "s1", checklist_id: "A" } },
    ] };
    case "temporary_tasks": return isAlarmQ
      ? { data: [{ id: "al", title: "Check Lobby", custom_times: ["09:00", "10:00"] }] }
      : { data: [{ id: "t1", title: "Restock cups", completed_at: "2026-10-12T20:00:00Z", completed_by: "u2" }], error: null };
    case "alarm_task_completions": return { data: [{ id: "c1", task_id: "al", completed_at: "2026-10-12T16:01:00Z", completed_by: "u2", interval_key: "x_0901" }] };
    case "temporary_task_subtasks": return { data: [] };
    case "event_task_completions": return { data: [{ id: "e1", completed_at: "2026-10-12T19:00:00Z", completed_by: "u1", event: { event_name: "Truck Delivery" } }], error: null };
    case "logbook_entries": return { data: [], error: null };
    case "profiles": return { data: [{ id: "u1", full_name: "Ana Ruiz" }, { id: "u2", full_name: "Ben Ito" }] };
  }
  return { data: [] };
}
const C = { timezone: "America/Los_Angeles", closeTime: "22:00", today: "2026-10-12", now: new Date("2026-10-20T12:00:00Z") };

Deno.test("14-day cap and defaults", () => {
  assertEquals(resolveDates({}, "2026-10-12"), { dates: ["2026-10-12"] });
  assertEquals((resolveDates({ start_date: "2026-10-01", end_date: "2026-10-14" }, "x") as any).dates.length, 14);
  assertEquals("error" in resolveDates({ start_date: "2026-10-01", end_date: "2026-10-15" }, "x"), true);
  assertEquals("error" in resolveDates({ date: "10/12" }, "x"), true);
});

Deno.test("range over 14 days asks to narrow without querying", async () => {
  const db = fakeDb();
  const r = await runQueryTaskHistory(db, { location_id: "L", start_date: "2026-09-01", end_date: "2026-10-01" }, C);
  assertEquals(typeof r.error, "string");
  assertEquals(db.tables.length, 0);
});

Deno.test("all kinds, names, average", async () => {
  const r = await runQueryTaskHistory(fakeDb(), { location_id: "L" }, C);
  const d = r.days[0];
  assertEquals(d.checklists.map((c: any) => [c.title, c.completed_items, c.total_items, c.percent, c.contributors]),
    [["Opening Checklist", 1, 2, 50, ["Ana Ruiz"]], ["De-Ice Machine", 0, 1, 0, []]]);
  assertEquals(d.checklist_average_percent, 25);
  assertEquals(d.quick_tasks, [{ title: "Restock cups", completed_at_local: "1:00 PM", completed_by: "Ben Ito" }]);
  assertEquals(d.alarms.map((a: any) => [a.slot_local, a.status, a.completed_by]), [["9:01 AM", "done", "Ben Ito"], ["11:00 AM", "missed", null]]);
  assertEquals(d.events_completed[0].completed_by, "Ana Ruiz");
});

Deno.test("kind filter only loads that kind", async () => {
  const db = fakeDb();
  const r = await runQueryTaskHistory(db, { location_id: "L", kind: "event" }, C);
  assertEquals(Object.keys(r.days[0]).sort(), ["date", "events_completed"]);
  assertEquals(db.tables.includes("checklists"), false);
  assertEquals(db.tables.includes("temporary_tasks"), false);
});

Deno.test("title fuzzy match and did_you_mean", async () => {
  const hit = await runQueryTaskHistory(fakeDb(), { location_id: "L", kind: "checklist", title: "icing" }, C);
  assertEquals(hit.days[0].checklists.map((c: any) => c.title), ["De-Ice Machine"]);
  assertEquals(hit.days[0].checklist_average_percent, 25); // header average unchanged by filter
  const miss = await runQueryTaskHistory(fakeDb(), { location_id: "L", kind: "checklist", title: "zzqq" }, C);
  assertEquals(miss.none, true);
  assertEquals(miss.did_you_mean.length, 2);
  const person = await runQueryTaskHistory(fakeDb(), { location_id: "L", person: "ben" }, C);
  assertEquals(person.days[0].quick_tasks.length, 1);
  assertEquals(person.days[0].checklists.length, 0);
});

// ── Step 3: open-task add-on ──
function fakeAdmin(access: boolean) {
  const calls: string[] = [];
  return {
    calls,
    rpc(fn: string, _a: any) {
      calls.push(fn);
      if (fn === "has_location_access") return Promise.resolve({ data: access, error: null });
      if (fn === "task_nudge_status") return Promise.resolve({ data: [
        { task_id: "o1", title: "Wipe patio tables", task_style: null, is_active: true, completed_at: null, expires_at: null, alarm_done_this_interval: false, subtasks_total: 3, subtasks_done: 1 },
        { task_id: "o2", title: "Restock cups", task_style: null, is_active: true, completed_at: "2026-10-12T20:00:00Z", expires_at: null, alarm_done_this_interval: false, subtasks_total: 0, subtasks_done: 0 },
        { task_id: "o3", title: "Check Lobby", task_style: "alarm", is_active: true, completed_at: null, expires_at: null, alarm_done_this_interval: false, subtasks_total: 0, subtasks_done: 0 },
        { task_id: "o4", title: "Old Flyer Hangup", task_style: null, is_active: true, completed_at: null, expires_at: "2026-10-01T00:00:00Z", alarm_done_this_interval: false, subtasks_total: 0, subtasks_done: 0 },
      ], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}
const CO = (admin: any) => ({ ...C, now: new Date("2026-10-12T23:00:00Z"), openTasks: { admin, userId: "me" } });

Deno.test("open task -> not done; completed -> done with who/when; expired hidden", async () => {
  const r = await runQueryTaskHistory(fakeDb(), { location_id: "L" }, CO(fakeAdmin(true)));
  const d = r.days[0];
  assertEquals(d.open_quick_tasks.map((t: any) => [t.title, t.status, t.subtasks_done, t.subtasks_total]),
    [["Wipe patio tables", "not done", 1, 3], ["Check Lobby", "not done this interval", 0, 0]]);
  assertEquals(d.quick_tasks, [{ title: "Restock cups", completed_at_local: "1:00 PM", completed_by: "Ben Ito" }]);
});

Deno.test("title matching covers completed and open together; expired only on explicit match", async () => {
  const open = await runQueryTaskHistory(fakeDb(), { location_id: "L", kind: "task", title: "patio" }, CO(fakeAdmin(true)));
  assertEquals(open.days[0].open_quick_tasks.map((t: any) => t.status), ["not done"]);
  assertEquals(open.days[0].quick_tasks, []);
  const done = await runQueryTaskHistory(fakeDb(), { location_id: "L", kind: "task", title: "restock cups" }, CO(fakeAdmin(true)));
  assertEquals(done.days[0].quick_tasks[0].completed_by, "Ben Ito");
  assertEquals(done.days[0].open_quick_tasks, []);
  const exp = await runQueryTaskHistory(fakeDb(), { location_id: "L", kind: "task", title: "flyer" }, CO(fakeAdmin(true)));
  assertEquals(exp.days[0].open_quick_tasks.map((t: any) => t.status), ["expired"]);
  const miss = await runQueryTaskHistory(fakeDb(), { location_id: "L", kind: "task", title: "patoi tabels" }, CO(fakeAdmin(true)));
  assertEquals(miss.days[0].open_quick_tasks[0].title, "Wipe patio tables"); // fuzzy hit on open task
});

Deno.test("no store access -> no add-on, no status call", async () => {
  const admin = fakeAdmin(false);
  const r = await runQueryTaskHistory(fakeDb(), { location_id: "L" }, CO(admin));
  assertEquals("open_quick_tasks" in r.days[0], false);
  assertEquals(admin.calls, ["has_location_access"]);
});

Deno.test("past date -> note, no add-on", async () => {
  const admin = fakeAdmin(true);
  const r = await runQueryTaskHistory(fakeDb(), { location_id: "L", date: "2026-10-10" }, CO(admin));
  assertEquals(r.open_status_note, "open/not-done status is only known for today");
  assertEquals("open_quick_tasks" in r.days[0], false);
  assertEquals(admin.calls, []);
});
