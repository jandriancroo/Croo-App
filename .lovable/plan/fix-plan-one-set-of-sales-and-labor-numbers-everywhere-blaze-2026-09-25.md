# Fix plan: one set of sales and labor numbers everywhere (Blaze first)

Goal: the store dashboard, the cubes, the multi-location dashboard and the Apple Watch all show the same goal, pace and labor, figured the same way, in each store's own time zone.

## Sign-offs needed before building
- **"unlock please"** for the 3D Data Cubes. The cubes' math changes; how they look and spin does not.
- **"confirm proceed"** for labor. Turning the POS labor switch back on writes QU labor into the labor records (tagged as coming from QU, never overwriting time clock rows).

## What changes (plain English)

### 1. Goal (keeps its wiggle)
- One rule everywhere: manager's custom goal, then the living goal, then the early goal, then the basic projection.
- The daily nudge of −3% to +2% stays. It's picked once per store per day and stays steady all day.
- Week and month goals use the same rule and the same nudge.

### 2. Pace (steady, with a momentum boost)
- Remove the random wobble that changes every refresh.
- Keep the momentum logic: finished hours compared to normal, split at 3 PM for lunch and dinner, at least 3 hours before trusting it, and dinner borrows half of lunch early on.
- **New momentum boost:** when the store is running ahead, pace gets a small extra lift, growing with how far ahead it is, up to about +3%. It only updates when an hour finishes. When the store is behind, there's no boost and no extra drop.
- "What hour is it" uses each store's own clock, so Texas and East Coast stores are figured right.
- Pace never goes below sales already rung.

### 3. Week and month pace (new, real)
- Week pace = days already done this week + today's pace + goals for the days left.
- Month pace = same idea, from the 1st.
- The week/month pace cubes and the watch show this instead of quietly showing the goal.

### 4. Labor source follows the store's switch
- The existing "Pull Qu Labor %" switch in the QU settings works again.
- **On:** that store's labor comes from QU. **Off:** it comes from the CrooHQ time clock.
- Rowlett gets switched **on**, and its past days since July 28 get refilled from QU.
- Time clock rows stay saved as they are. Nothing is deleted.

### 5. Labor % in the multi-location totals strip
- Total labor ÷ total sales across stores, not an average of each store's percent.
- Week-to-date labor there and on the watch starts Monday, not the 1st.

### 6. Cubes show the right day
- A cube labeled "today" always shows today, even if the sales widget is looking at another date.

### 7. Nightly catch-up
- Find out why the nightly re-sync of yesterday skipped Rowlett, and make sure every Blaze store gets its final numbers after close.

## Not changing
- SDLY, SWLY and SDLW cubes are already correct.
- Today's live labor with real wages stays as is: every viewer sees the same store-level numbers, and shift managers never see personal wages.
- How cubes look, rotate and animate.

## How we'll check it
- For Hemet, Palm Desert and Rowlett: store dashboard, cubes, multi-location dashboard and watch show the same goal, pace and labor for today and for Sep 22–24.
- Pace stays the same across refreshes until an hour finishes.
- Rowlett shows real QU labor instead of $0.

## Technical details
- One shared calculation in `_shared/projections.ts` (goal order, seeded goal factor, deterministic momentum boost, week/month pace, store timezone). `fetch-qubeyond-sales`, `sales-service`, `watch-device-service` and `useOrgDashboardData` all use it or read its saved output. Remove the `Math.random` in pace in `fetch-qubeyond-sales`, `_shared/projections.ts` and `useOrgDashboardData.ts`.
- Save `weekPaceAdjusted`/`monthPaceAdjusted` alongside today's pace so the org dashboard and watch read them instead of recalculating.
- Momentum boost: `boost = min(max(activeAvg,0)/0.5,1) * 0.03 * seeded(store,date,hour)`. Nothing is applied when `activeAvg < 0`.
- Labor: bring back reading QU labor behind `credentials.pull_labor`. Upsert into `labor_cache` with `source='qubeyond'` on (location_id, labor_date, source). Readers pick the row matching the store's switch. `sales_cache` stays sales-only.
- `OrgTotalsBar`: Σlabor$ / Σsales$. Org and watch WTD start from the Luxon week start in the store's timezone.
- Add the business date to the `['dashboard-sales-enriched', locationId]` cache key, and have cubes request today explicitly.
- Rowlett backfill Jul 28 onward through the existing maintenance queue, 7 days per batch.
