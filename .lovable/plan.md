# Data cube vs Sales Summary audit — Blaze Pizza (read-only findings + fix plan)

Nothing was changed. All data below is from read-only queries run 01:10 UTC Sep 25 (6:10 PM PT Sep 24).

## Bottom line for Dave

The cubes and the Sales Summary don't read the same numbers the same way. There are three different "goal" rules, pace has a random wobble in it, the org view works out "now" in Pacific time for every store, and one store (Rowlett) has had $0 labor saved for two days. Most of the gaps give **wrong numbers**, not just a delay.

---

## List A — Sales Summary widget (store dashboard)

| # | Data point | Source (code → server → table) | Date basis | Refresh |
|---|---|---|---|---|
| A1 | Sales today | SalesSummary.tsx → `fetch-qubeyond-sales` (live QU pull), result cached in the browser | Pacific date hardcoded (fetch-qubeyond-sales 2388) | useQuery `["qubeyond-sales", loc, date]`, 3-min staleTime (913); 3-min browser cache; refreshes while visible from open to close + 60 min (≈960–1000) |
| A2 | Goal / projection | `sales_cache` override > living > initial (useResolvedProjection.tsx 4), cached in the browser 30 min (salesCache.ts) | sale_date | same as A1 |
| A3 | Pace | `calculatePaceAdjustedProjection` in fetch-qubeyond-sales (≈2000–2040), includes `Math.random` (2033) | Current hour in Pacific time (2282) | every refresh; pace cached 7 min |
| A4 | WTD / MTD sales | sales_cache rows Mon/1st → today + today's live number | Pacific date | same as A1 |
| A5 | Labor $ / % today | `fetchLiveLaborForToday` → `get_live_labor_totals` RPC (liveLabor.ts 34) — server side, real wages | store timezone | with widget refresh |
| A6 | Labor closed days | `labor_cache`, punch_clock preferred over qubeyond (SalesSummary 395, 670–730) | labor_date | written nightly |
| A7 | Last year / comparisons | fetch-qubeyond-sales `lastYear.*`, `comparison.prevDay/prevDayFullDay` (3202) | Pacific | with A1 |
| A8 | Guests, avg ticket, payments | sales_cache / live pull | Pacific | with A1 |

Server writers: `sync-sales-every-minute` cron (open → close) and the nightly `maintenance-service` → `sales-service?action=sync-yesterday` (uses each store's timezone, sales-service ≈1040–1060).

## List B + C — cube equivalents and how they're built (differences highlighted)

**Store dashboard cubes** (DataCube3D.tsx / DashboardWidget.tsx): these don't fetch anything. They read `['dashboard-sales-enriched', locationId]` (Dashboard.tsx 101), which SalesSummary writes (SalesSummary 1391). They are identical to List A, **except** the cache name has no date in it.

**Org / brand cubes** (useOrgDashboardData.ts → OrgCubeStyleB, OrgTotalsBar): read sales_cache and labor_cache directly (196–206); live labor from the same RPC as A5; refetch every 2 min, 60s staleTime (404–405).

**Watch** (watch-device-service buildSnapshot 122–210): reads sales_cache and labor_cache using the store's own timezone (130).

| Item | Org cube | Watch | vs widget | Rating |
|---|---|---|---|---|
| Sales today | sales_cache.net_sales (≤1 min behind the cron) | same | widget is a live pull | lag only |
| Goal | override → initial → projected, **skips living** (320) | override → living → **projected → initial** (171) | widget: override → living → initial | **wrong numbers** |
| Pace | own copy of the math with its own `Math.random` (291), Pacific hour (236) | stored pace_adjusted_projection, otherwise living (176) — this is **null on every row checked**, so it shows living | random each time | **wrong numbers** |
| Labor % today | server RPC | server RPC | same | matches |
| Labor WTD | labor fetched only from the 1st of the month (201–206) | month start (150) | widget covers the full week | **wrong** when a week spans two months |
| Totals-bar labor % | plain average of each store's % (OrgTotalsBar 16–45) | — | should be total labor ÷ total sales | **wrong numbers** |
| Last year | yoy_net_sales | yoy_net_sales | the `sales_last_year` cube uses prevDayFullDay | **wrong label/number** |
| Guests, payments, pizzas | not on org cubes | on watch | — | cube gap |

Cube-only metrics: 7-day sparkline, hourly bars (org); pizza count, avg ticket (watch).

## Your 9 suspicions — verdicts

1. **Goal — CONFIRMED** (useOrgDashboardData 320). The watch uses a third order (watch-device-service 171).
2. **Random pace — CONFIRMED** in both places (fetch-qubeyond-sales 2033, useOrgDashboardData 291).
3. **Timezone — CONFIRMED** (fetch-qubeyond-sales 149/155/176/2282/2388; useOrgDashboardData 8, 236). Rowlett is `America/Chicago`. The nightly yesterday resync and the watch *do* use each store's timezone.
4. **$15 wage fallback — REFUTED for today's labor $/%.** liveLabor.ts now uses the server RPC, so everyone sees the same aggregate. The `?? 15` fallback still exists in usePrefetchDashboard.tsx 236 (the scheduled-labor preload), so *scheduled* labor could still vary by viewer. Worth a follow-up check.
5. **WTD labor from the 1st — CONFIRMED** (useOrgDashboardData 201–206).
6. **Unweighted average — CONFIRMED** (OrgTotalsBar 16–45).
7. **Cache key has no date — CONFIRMED** (Dashboard.tsx 101; SalesSummary 1333/1391). This is the day being viewed, not always today.
8. **sales_last_year = prevDayFullDay — CONFIRMED** (DataCube3D 187, DataCube 97, watchMetrics 83).
9. **No QU yesterday resync — PARTLY REFUTED.** One exists: nightly maintenance-service → sales-service `sync-yesterday` (maintenance-service 229). Hemet and Palm Desert rows were updated at 1:43–4:48 AM PT. **But Rowlett's rows were last fetched 8:18 PM and 8:34 PM PT** (10:18 PM / 10:34 PM Central, right at close), so the nightly pass did not refresh Rowlett. The blaze-pizza.md "every 15 min / 3 AM" wording is inaccurate (the cron runs every minute, and yesterday's resync is part of nightly maintenance).

## Proof — Sep 22–24 (times are Pacific)

| Store | Date | Net sales | Widget goal (ovr>liv>ini) | Org goal (ovr>ini>proj) | Gap | Sales last fetched | Labor row |
|---|---|---|---|---|---|---|---|
| Hemet | 9/22 | 2,040 | 2,191 | 2,349 | +158 | 9/23 04:30 | punch $807 / 37.5h @ 9/23 04:03 |
| Hemet | 9/23 | 3,077 | 2,789 | 2,563 | −226 | 9/24 01:43 | punch $752 / 34.7h @ 9/24 04:02 |
| Hemet | 9/24 | 1,538 (live) | 3,076 | 2,768 | −308 | 9/24 18:11 | none (today) |
| Palm Desert | 9/22 | 2,051 | 2,040 | 2,218 | +178 | 9/23 04:27 | punch $599 / 28.2h |
| Palm Desert | 9/23 | 2,532 | 1,846 | 2,068 | +222 | 9/24 04:48 | punch $551 / 26.4h |
| Palm Desert | 9/24 | 1,328 | 2,254 | 2,302 | +48 | 9/24 18:11 | none |
| Rowlett (CT) | 9/22 | 847 | 1,369 | 1,423 | +54 | **9/22 20:18** | **punch $0 / 0h** |
| Rowlett (CT) | 9/23 | 1,540 | 1,508 | 1,408 | −100 | **9/23 20:34** | **punch $0 / 0h** |
| Rowlett (CT) | 9/24 | 1,205 | 1,968 | 1,774 | −194 | 9/24 18:11 | none |

Stored pace is empty on all 9 rows, so the watch falls back to the living goal. Sep 22 and 23 are both inside September, so suspicion 5 doesn't show up in these dates.

**New finding:** Rowlett has a punch_clock labor row with $0 and 0 hours and no QU labor row. Because punch_clock wins over QU, every closed-day labor % for Rowlett shows 0 / blank in both the widget and the cubes. The cause isn't confirmed yet. Either Rowlett doesn't punch in CrooHQ, or the nightly labor run writes an empty punch row that blocks the QU labor.

## Root cause

There are three separate copies of the "metrics" math (browser widget, browser org hook, watch server). Each has its own goal order, pace formula, timezone handling and date range. On top of that, the pace has random noise in it, and the nightly processes skip or zero out a Central-time store.

## Proposed fix direction (not built — needs approval)

1. **One server-side metrics function** (per store + date + period) used by the widget, the store cubes, the org cubes and the watch. It returns sales, goal, pace, WTD/MTD, labor $/hours/% and last year.
2. **One goal rule:** override > living > initial > projected, everywhere.
3. **Deterministic pace:** remove `Math.random`, and use the store's timezone for the current hour.
4. **Store timezone + business date everywhere:** remove the hardcoded Pacific time in fetch-qubeyond-sales and useOrgDashboardData.
5. **Labor:** server-side real-wage totals for any viewer; fetch WTD from Monday; weighted totals (Σlabor ÷ Σsales) in the org bar. Only save a punch_clock labor row when there are punches (it must never be $0 and hide QU). Keep the `source` column and the unique rule on labor_cache.
6. **Resync:** find out why the nightly sync-yesterday skipped Rowlett. Add a post-close sweep (close + 90 min in store time) for QU stores. Fix the blaze-pizza.md cadence text.
7. **Cube fixes:** put the date in the enriched cache name; point `sales_last_year` at lastYear.sameDay (or rename it "Yesterday").
8. Check the `?? 15` scheduled-labor fallback in usePrefetchDashboard.

**Locked-feature note:** items 1, 7 and part of 3 touch the 3D Data Cubes, which are locked. They need your explicit "unlock please" before anyone builds them. Items 5 and 6 touch labor_cache / sales_cache writers and need your "confirm proceed" under the cache rules.

## Open questions before building
- Does Rowlett punch in CrooHQ, or should its labor come only from QU?
- Should the store dashboard also switch to the shared server function, or only the cubes and watch?
