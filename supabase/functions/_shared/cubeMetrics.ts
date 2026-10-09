// The ONE source of cube math (goal, pace, labor %, store "now").
// Pure TypeScript — no Deno or npm imports — so Vite (src/) and Deno (edge functions)
// both import it. Used by: store dashboard (SalesSummary / Dashboard cubes), org
// dashboard (useOrgDashboardData / OrgTotalsBar), dock CompactDashboard, and
// watch-device-service.

export type GoalSource = "override" | "living" | "initial" | "legacy";

export interface GoalRow {
  override_projection?: number | string | null;
  living_projection?: number | string | null;
  initial_projection?: number | string | null;
  projected_sales?: number | string | null;
}

/** Goal: override > living > initial > projected_sales; values <= 0 are ignored. */
export function resolveGoalWithSource(row: GoalRow | null | undefined): { value: number | null; source: GoalSource | null } {
  if (!row) return { value: null, source: null };
  const order: [GoalSource, unknown][] = [
    ["override", row.override_projection],
    ["living", row.living_projection],
    ["initial", row.initial_projection],
    ["legacy", row.projected_sales],
  ];
  for (const [source, v] of order) {
    const n = Number(v);
    if (v != null && Number.isFinite(n) && n > 0) return { value: n, source };
  }
  return { value: null, source: null };
}

export function resolveGoal(row: GoalRow | null | undefined): number | null {
  return resolveGoalWithSource(row).value;
}

/** Store-local date and clock for a time zone (location_settings.timezone). */
export function storeNow(tz: string, at: Date = new Date()): { date: string; hour: number; minute: number } {
  const zone = tz || "America/Los_Angeles";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

export const PACE_FRESH_MS = 15 * 60 * 1000;
const SHIFT_BOUNDARY = 15; // 3 PM: lunch before, dinner after
const MIN_POINTS = 3;

export interface PaceInput {
  hourly_data: unknown;
  net_sales: number | string | null | undefined;
  pace_adjusted_projection?: number | string | null;
  pace_calculated_at?: string | null;
  nowInStoreTz: { hour: number; minute: number };
  nowMs?: number; // for tests; defaults to Date.now()
}

function hourOf(entry: any): number {
  const s = String(entry?.hour ?? "");
  return parseInt(s.includes(":") ? s.split(":")[0] : s, 10);
}

/**
 * Today's pace. Fresh stored pace (< 15 min) wins; otherwise the shift-aware V3
 * math. Deterministic: same input → same output. Never below sales so far.
 * Returns null when there is no hourly data.
 */
export function computePace(i: PaceInput): number | null {
  const hourly = Array.isArray(i.hourly_data) ? (i.hourly_data as any[]) : null;
  if (!hourly || hourly.length === 0) return null;
  const sales = Number(i.net_sales) || 0;
  const now = i.nowMs ?? Date.now();

  const stored = Number(i.pace_adjusted_projection) || 0;
  if (stored > 0 && i.pace_calculated_at) {
    const at = new Date(i.pace_calculated_at).getTime();
    if (Number.isFinite(at) && now - at < PACE_FRESH_MS) return Math.max(stored, sales);
  }

  const { hour: curH, minute: curM } = i.nowInStoreTz;
  const lunch: number[] = [];
  const dinner: number[] = [];
  for (const e of hourly) {
    const h = hourOf(e);
    if (Number.isNaN(h)) continue;
    const actual = Number(e?.sales) || 0;
    const projected = Number(e?.projected) || 0;
    if (projected <= 0) continue;
    const done = (h < curH && actual > 0) || (h === curH && curM >= 30 && actual > 0);
    if (!done) continue;
    (h < SHIFT_BOUNDARY ? lunch : dinner).push((actual - projected) / projected);
  }
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  let active: number | null = null;
  if (curH >= SHIFT_BOUNDARY) {
    if (dinner.length >= MIN_POINTS) active = avg(dinner);
    else if (lunch.length >= MIN_POINTS) active = avg(lunch) * 0.5; // lunch carry at 50%
  } else if (lunch.length >= MIN_POINTS) {
    active = avg(lunch);
  }
  // Momentum boost only when ahead, scaled, capped at +3%.
  const factor = active === null ? 1 : 1 + active + (active > 0 ? 0.03 * Math.min(active / 0.5, 1) : 0);

  let sum = 0;
  for (const e of hourly) {
    const h = hourOf(e);
    if (Number.isNaN(h)) continue;
    const actual = Number(e?.sales) || 0;
    const projected = Number(e?.projected) || 0;
    if (h < curH) sum += actual;
    else if (h === curH) sum += curM < 30 ? projected * factor : actual + projected * ((60 - curM) / 60) * factor;
    else sum += projected * factor;
  }
  return sum > 0 ? Math.max(sum, sales) : null;
}

/** Labor % for one store-day; null when either side is missing. */
export function laborPct(labor: number | null | undefined, sales: number | null | undefined): number | null {
  const l = Number(labor);
  const s = Number(sales);
  if (!(l > 0) || !(s > 0)) return null;
  return (l / s) * 100;
}

/** Σlabor / Σsales × 100 over rows with labor > 0 and sales > 0. */
export function weightedLaborPct(rows: { labor: number | null | undefined; sales: number | null | undefined }[]): number | null {
  let l = 0;
  let s = 0;
  for (const r of rows || []) {
    const lv = Number(r?.labor);
    const sv = Number(r?.sales);
    if (lv > 0 && sv > 0) { l += lv; s += sv; }
  }
  return s > 0 ? (l / s) * 100 : null;
}
