// query_checklist_items: item-level read of one checklist on one business date.
// The expected item set comes ONLY from planChecklistDay in ../_shared/taskHistory/core.ts,
// so total_items always equals what Tasks > History counts. Run with the caller's client.
import { planChecklistDay, type TaskHistoryCtx } from "../_shared/taskHistory/core.ts";
import { getBusinessDayRangeInTimezone } from "../_shared/taskHistory/helpers.ts";
import { bestMatches, closest } from "../_shared/fuzzyMatch.ts";

export const QUERY_CHECKLIST_ITEMS_TOOL = {
  type: "function",
  function: {
    name: "query_checklist_items",
    description: "Item-level detail for ONE checklist on one business date: each expected item done / not done, the answer, temperature (and if it was in range), photo, who did it and when, plus the list of missing items. Totals match Tasks > History. Use for 'was X done', 'what temp', 'who did it', 'what's missing'.",
    parameters: {
      type: "object",
      properties: {
        location_id: { type: "string", description: "UUID of the location" },
        checklist: { type: "string", description: "Checklist title, fuzzy matched" },
        item: { type: "string", description: "Optional item question, fuzzy matched" },
        date: { type: "string", description: "Business date YYYY-MM-DD (default: today's business date)" },
      },
      required: ["location_id", "checklist"],
    },
  },
};

export interface ChecklistItemsToolCtx { timezone: string; closeTime: string | null; today: string; now: Date }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (iso: string | null | undefined, tz: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
};

export async function runQueryChecklistItems(db: any, args: any, c: ChecklistItemsToolCtx): Promise<any> {
  const date = args?.date || c.today;
  if (!DATE_RE.test(date)) return { error: "Date must be YYYY-MM-DD." };
  const checklistQ = typeof args?.checklist === "string" ? args.checklist.trim() : "";
  if (!checklistQ) return { error: "Which checklist?" };
  const locationId = args.location_id;

  const { start, end } = getBusinessDayRangeInTimezone(date, c.timezone, c.closeTime);
  const ctx: TaskHistoryCtx = { locationId, dateStr: date, timezone: c.timezone, closeTime: c.closeTime, periodStart: start, periodEnd: end, now: c.now };

  const { data: versions } = await db
    .from("checklists")
    .select(`id, title, template_type, frequency, scheduled_date, visible_days_before_month_end, schedule_repeats, schedule_period, schedule_mode, schedule_weekdays, schedule_day, schedule_quarter_month, schedule_last_n, due_by_time, is_active, family_id, replaces_checklist_id, superseded_at,
      checklist_items(id, question, days_of_week, item_type, deleted_at)`)
    .neq("template_type", "training")
    .eq("location_id", locationId)
    .order("display_order", { ascending: true });

  const plan = planChecklistDay(versions, ctx);
  const titles = plan.map((p: any) => p.title);
  const hits = new Set(bestMatches(checklistQ, titles));
  if (!hits.size) return { none: true, checklist: checklistQ, date, did_you_mean: closest(checklistQ, titles, 5) };
  const matched = plan.filter((p: any) => hits.has(p.title));
  if (matched.length > 1) return { ambiguous: true, checklist: checklistQ, date, did_you_mean: matched.map((p: any) => p.title).slice(0, 5) };
  const cl = matched[0];

  const { data: resp } = await db
    .from("checklist_responses")
    .select("item_id, response_text, extracted_temperature, temperature_valid, response_image_url, completed_by, created_at, checklist_submissions!inner(id, checklist_id)")
    .eq("checklist_submissions.checklist_id", cl.id)
    .eq("checklist_submissions.location_id", locationId)
    .gte("created_at", cl.periodStart.toISOString())
    .lte("created_at", cl.periodEnd.toISOString())
    .not("completed_by", "is", null);

  // Latest response per expected item.
  const latest: Record<string, any> = {};
  for (const r of (resp || []) as any[]) {
    if (!r.item_id || !cl.expectedItemIds.has(r.item_id)) continue;
    if (!latest[r.item_id] || (r.created_at || "") > (latest[r.item_id].created_at || "")) latest[r.item_id] = r;
  }
  const ids = Array.from(new Set(Object.values(latest).map((r: any) => r.completed_by).filter(Boolean)));
  const names: Record<string, string> = {};
  if (ids.length) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", ids);
    (data || []).forEach((p: any) => { names[p.id] = p.full_name; });
  }

  const allItems = (cl.expectedItems as any[]).map((it) => {
    const r = latest[it.id];
    const row: any = { question: it.question, status: r ? "done" : "not done" };
    if (r) {
      if (r.response_text != null && r.response_text !== "") row.answer = r.response_text;
      if (r.extracted_temperature != null) {
        row.temperature = r.extracted_temperature;
        if (r.temperature_valid != null) row.temperature_valid = r.temperature_valid;
      }
      if (r.response_image_url) row.photo = true;
      row.completed_by = names[r.completed_by] || null;
      row.completed_at_local = fmt(r.created_at, c.timezone);
    }
    return row;
  });

  const completed = Math.min(Object.keys(latest).length, cl.itemCount);
  const total = cl.itemCount;
  let items = allItems;
  const itemQ = typeof args?.item === "string" ? args.item.trim() : "";
  if (itemQ) {
    const qs = allItems.map((i) => i.question);
    const ih = new Set(bestMatches(itemQ, qs));
    if (!ih.size) return { checklist: cl.title, date, none: true, item: itemQ, did_you_mean: closest(itemQ, qs, 5), completed_items: completed, total_items: total };
    items = allItems.filter((i) => ih.has(i.question));
  }

  return {
    checklist: cl.title,
    date,
    timezone: c.timezone,
    percent: total > 0 ? Math.round(Math.min(completed / total, 1) * 100) : 0,
    completed_items: completed,
    total_items: total,
    items,
    missing_items: allItems.filter((i) => i.status === "not done").map((i) => i.question),
  };
}
