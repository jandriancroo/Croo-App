# Usage Forecasting for Genius Order Coach

Replace the current point-to-point averaging in `computeUsageCoach` with a proper sales-linked forecasting engine that models the shape of the week, learns per-item usage rates over time, and produces auditable order recommendations. Brandon confirms every order — nothing is auto-placed.

## 1. Schema (one migration)

**Extend `lite_inventory_items`** (this is our "items" table for Lite):
- `usage_model` enum(`sales_linked`|`time_based`|`par_based`) default `sales_linked`
- `usage_model_locked` bool default false
- `units_per_case` numeric, `order_unit` text
- `rounding_policy` enum(`up`|`down`|`nearest`) default `up`
- `par_level` numeric null
- `lead_time_days` int, `delivery_dows` int[]

**New tables** (all with GRANTs + RLS scoped to location membership):
- `item_usage_periods` — one row per item per closed count window; stores qty_start, qty_received, qty_end, usage, net_sales, usage_per_dollar, days_in_period, `receipt_date_source` (`physical`|`invoice`), `is_excluded`, `exclusion_reason`, excluded_by/at.
- `dow_sales_profile` — location_id + day_of_week (0=Sun); avg/min/max/stddev net sales, share_of_week, weeks_in_sample, computed_at.
- `item_usage_rates` — current fitted state: weekly_usage_level, alpha, residual_stddev, r2_usage_vs_sales, periods_used, last_fitted_at.
- `order_recommendations` — logs every rec for backtesting; forecast_qty, projected_on_hand, safety_stock, recommended_qty/cases, level_used, shape_source (`sales_linked_dow`|`daily_projection`|`manager_override`|`time_based`|`par_based`), trend_factor, actual_ordered_qty/actual_usage_qty (nullable, back-filled later).

## 2. Business-date correctness

Every date field books to the location's **business date** (`getBusinessDateInTimezone` from `useLocationTimezone`, which honors `close_time` + buffer). Counts, receipts, sales all resolve to the same business date or the math silently breaks. No `created_at`, no calendar date.

## 3. Forecasting engine (edge function `genius-usage-engine`)

Four RPC-style actions, all timezone-aware:

**`buildUsagePeriods(item_id)`** — pair consecutive submitted counts; `usage = qty_start + Σreceipts − qty_end`; `net_sales` summed over the same business dates from `sales_cache`. Receipts join on `physical_delivery_date` if present, else `invoice_date` (record which was used). Auto-exclude when `days_in_period > 9`, `qty_end <= 0`, `usage < 0`, or `usage_per_dollar` outside 2.5 MAD of the item median.

**`refreshDowProfile(location_id)`** — trailing 16 weeks of daily net sales grouped by DOW, business-date aware; skip holiday/closure flags; store share_of_week, min/max/stddev.

**`fitUsageRate(item_id)`** — non-excluded periods, most recent first. Exponentially weighted `weekly_usage_level` (α=0.35, normalized to 7 days). Compute `r2_usage_vs_sales` and `residual_stddev`. If not `usage_model_locked`, auto-classify: R² ≥ 0.6 → sales_linked; R² < 0.6 with par set → par_based; else time_based. Fewer than 4 valid periods → return low-confidence flag, no number.

**`recommendOrder(item_id, as_of_date)`** — coverage window = `as_of_date` → next delivery + `lead_time_days`.
- `sales_linked`: `trend = clamp(projected_week_sales / typical_week_sales, 0.85, 1.25)`; per-day forecast = `weekly_usage_level × share_of_week[dow] × trend`. Prefer that day's specific sales projection (including manager overrides) over the DOW average when available.
- `time_based`: `Σusage / Σdays × days_in_coverage`.
- `par_based`: `par_level − projected_on_hand`.
- `safety = 1.65 × residual_stddev × sqrt(days_in_coverage)`
- `raw = forecast − projected_on_hand + safety`
- `cases = applyRounding(raw / units_per_case, rounding_policy)`

Every call writes the full computed row to `order_recommendations`.

## 4. Frontend

**Genius Order Coach panel** (`GeniusOrderCoachPanel.tsx`, replaces current `computeUsageCoach` reads):
- Recommended **cases** (large) + raw unit figure beside it.
- One-line rationale, e.g. *"~21 bags/week · covering Thu–Sun (busy, 1.18× avg) · 6 on hand"*.
- Confidence badge: green ≥ 8 valid periods, amber 4–7, red < 4.
- Expandable per-day breakdown table.

**Admin → Usage Models** (new page under Inventory settings):
- Item list: usage_model, R², residual %, periods used, last fitted.
- Toggle `usage_model_locked`, override class.
- Excluded-periods list with reasons; manual exclude/restore.

## 5. Scheduling

- Nightly cron (extend `sync_all_yesterday` batch): refresh DOW profile, rebuild periods for items with new counts/receipts, refit rates.
- On count submit: rebuild periods for that count's items + refit.
- On demand: "Refit" button in Admin.

## 6. Rollout

- Ship schema + engine + Admin page dark.
- Keep old `computeUsageCoach` output alongside new engine for one week; log divergence.
- Flip Genius panel to new engine once Brandon signs off on the shadow numbers.

---

## Technical notes

- Engine lives in `supabase/functions/genius-usage-engine/index.ts`; small pure helpers extracted to `_shared/usageMath.ts` for unit tests.
- Business-date resolution uses the same Luxon helpers already documented in `.lovable/knowledge/date-architecture.md`.
- `computeUsageCoach.ts` stays for now (fallback + shadow compare); deleted after cutover.
- No changes to POS ingestion, `sales_cache`, or count-entry flows.
- All new tables get `GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated`, `GRANT ALL ... TO service_role`, RLS scoped via existing location-membership helpers.

Approve and I'll ship it in this order: (1) migration, (2) engine + shared math, (3) Genius panel wiring behind a shadow flag, (4) Admin Usage Models page, (5) cron hooks.