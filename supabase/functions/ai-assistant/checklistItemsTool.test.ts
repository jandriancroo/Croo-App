import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runQueryChecklistItems } from "./checklistItemsTool.ts";
import { loadChecklistHistory } from "../_shared/taskHistory/core.ts";
import { getBusinessDayRangeInTimezone } from "../_shared/taskHistory/helpers.ts";

// Mon=0 → 2026-10-12 is a Monday.
const CHECKLISTS = [
  { id: "A", title: "Opening Checklist", template_type: "standard", frequency: "daily", is_active: true,
    checklist_items: [
      { id: "h", question: "Front", item_type: "section_header" },
      { id: "a1", question: "Walk-in cooler temp", item_type: "temperature" },
      { id: "a2", question: "Lights on", item_type: "checkbox" },
      { id: "a3", question: "Old item", item_type: "checkbox", deleted_at: "2026-01-01T00:00:00Z" },
    ] },
  { id: "D", title: "Weekly Deep Clean", template_type: "dynamic", frequency: "weekly", is_active: true,
    checklist_items: [
      { id: "d1", question: "Mop floors", item_type: "checkbox", days_of_week: [0] },
      { id: "d2", question: "Clean hood", item_type: "checkbox", days_of_week: [3] },
    ] },
];
const RESPONSES = [
  { item_id: "a1", submission_id: "s1", completed_by: "u1", created_at: "2026-10-12T16:00:00Z", response_text: "36", extracted_temperature: 36, temperature_valid: true, response_image_url: "https://x/p.jpg", checklist_submissions: { id: "s1", checklist_id: "A" } },
  { item_id: "d1", submission_id: "s2", completed_by: "u1", created_at: "2026-10-12T17:00:00Z", checklist_submissions: { id: "s2", checklist_id: "D" } },
];

function fakeDb() {
  return {
    from(table: string) {
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
  if (table === "checklists") return { data: CHECKLISTS };
  if (table === "checklist_responses") {
    const ids = new Set<string>();
    for (const [m, a] of ops) {
      if (m === "eq" && a[0] === "checklist_submissions.checklist_id") ids.add(a[1]);
      if (m === "in" && a[0] === "checklist_submissions.checklist_id") a[1].forEach((x: string) => ids.add(x));
    }
    return { data: RESPONSES.filter((r) => ids.has(r.checklist_submissions.checklist_id)) };
  }
  if (table === "profiles") return { data: [{ id: "u1", full_name: "Ana Ruiz" }] };
  return { data: [] };
}
const C = { timezone: "America/Los_Angeles", closeTime: "22:00", today: "2026-10-12", now: new Date("2026-10-12T20:00:00Z") };

Deno.test("totals equal the History loader for the same fixture", async () => {
  const { start, end } = getBusinessDayRangeInTimezone("2026-10-12", C.timezone, C.closeTime);
  const hist = await loadChecklistHistory(fakeDb(), { locationId: "L", dateStr: "2026-10-12", timezone: C.timezone, closeTime: C.closeTime, periodStart: start, periodEnd: end, now: C.now });
  for (const [q, id] of [["opening", "A"], ["deep clean", "D"]]) {
    const r = await runQueryChecklistItems(fakeDb(), { location_id: "L", checklist: q }, C);
    const h = hist.find((x) => x.id === id)!;
    assertEquals([r.completed_items, r.total_items, r.percent], [h.completedCount, h.itemCount, Math.round(h.completionRate * 100)]);
  }
});

Deno.test("done / not done, temperature, photo, missing", async () => {
  const r = await runQueryChecklistItems(fakeDb(), { location_id: "L", checklist: "Opening Checklist" }, C);
  assertEquals(r.items, [
    { question: "Walk-in cooler temp", status: "done", answer: "36", temperature: 36, temperature_valid: true, photo: true, completed_by: "Ana Ruiz", completed_at_local: "9:00 AM" },
    { question: "Lights on", status: "not done" },
  ]);
  assertEquals(r.missing_items, ["Lights on"]);
  const d = await runQueryChecklistItems(fakeDb(), { location_id: "L", checklist: "deep clean" }, C);
  assertEquals(d.items.map((i: any) => i.question), ["Mop floors"]); // dynamic: Monday only
});

Deno.test("item filter keeps totals", async () => {
  const r = await runQueryChecklistItems(fakeDb(), { location_id: "L", checklist: "opening", item: "cooler" }, C);
  assertEquals(r.items.length, 1);
  assertEquals([r.completed_items, r.total_items, r.missing_items], [1, 2, ["Lights on"]]);
});

Deno.test("did_you_mean for checklist and item", async () => {
  const c = await runQueryChecklistItems(fakeDb(), { location_id: "L", checklist: "pizza" }, C);
  assertEquals(c.none, true);
  assertEquals(c.did_you_mean.length, 2);
  const i = await runQueryChecklistItems(fakeDb(), { location_id: "L", checklist: "opening", item: "zzzz" }, C);
  assertEquals(i.none, true);
  assertEquals(i.did_you_mean.sort(), ["Lights on", "Walk-in cooler temp"]);
});
