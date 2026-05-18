# Palm Springs COGS Backfill — Resume Notes

_Saved so we can pick this up cold._

## Where we are
Diagnosed a systemic gap in `inventory_count_items.cost_at_count` at Palm Springs (`d667741f...`). 100% of rows in the affected counts have `cost_at_count = NULL`, so historical AvT/COGS valuations are silently using current live cost — which has drifted low, deflating beginning/ending inventory.

## Tonight's work (plain English)
- **Problem:** Counts kept shifting. Mar 31 month-end was deflated on both ends. Apr 12 had a right ending but deflated beginning (inherited from March). Apr month-end then used a bad starting point. Any unit-setup change to a product silently re-priced old counts.
- **Root cause:** `cost_at_count` not being snapshotted, so historical valuation reads live cost.
- **Fix path:** Backfill `cost_at_count` for NULL rows using the cost stamped on the *next* valid snapshot (preferred), falling back to the prior snapshot, falling back to live cost.

## Preview results (read-only, Mar 2 → Apr 13, Palm Springs only)

| Count Date | Rows | NULL | Fix via NEXT | Unresolvable | Before | After | Δ |
|---|---:|---:|---:|---:|---:|---:|---:|
| Mar 02 | 191 | 191 | 179 | 12 | $23,801.06 | $56,710.01 | +$32,908.95 |
| Mar 08 | 192 | 192 | 180 | 12 | $75,545.67 | $115,910.64 | +$40,364.97 |
| Mar 16 | 191 | 191 | 179 | 12 | $36,145.33 | $77,695.48 | +$41,550.16 |
| Mar 17 | 192 | 192 | 180 | 12 | $30,981.31 | $65,875.55 | +$34,894.25 |
| Mar 30 | 192 | 192 | 180 | 12 | $32,680.22 | $62,217.79 | +$29,537.56 |
| Apr 01 | 206 | 206 | 190 | 16 | $30,358.44 | $72,559.05 | +$42,200.61 |
| Apr 06 | 206 | 206 | 190 | 16 | $26,379.10 | $63,407.21 | +$37,028.11 |
| Apr 13 | 267 | 267 | 211 | 56 | $114,333.38 | $158,352.18 | +$44,018.81 |

Total NULL rows to update: **1,637** across 8 counts.

## UI validation (COGS screen, week Apr 13–19)
- Beginning Inventory (Apr 12): **$8,029.77** (deflated — this is the symptom)
- Ending Inventory (Apr 19): $6,913.64
- Purchases: $6,582.05 (2 PFG + 3 PA)
- Actual COGS: $7,698.18 → 26.9% of $28,566 net sales
- Theoretical Usage: **$0.00** → drives full +$7,698 red variance (separate issue)

Once the backfill runs, Apr 13 ending jumps to ~$158k, becoming the correct beginning for April month-end.

## Decisions pending
1. **Run the backfill?** Mar 2 → Apr 13, Palm Springs only, 1,637 NULL rows. Formula: `cost_at_count = COALESCE(next_snapshot, prior_snapshot, live_cost)`.
2. **Theoretical Usage = $0** — separate investigation. Either no recipes/POS mix resolved for the week, or theoretical calc isn't pulling.
3. **Why are stamps NULL system-wide at PS?** Need to confirm the save path is actually writing `cost_at_count` going forward, otherwise we'll be backfilling forever.

## Files touched tonight
- `src/utils/countItemValue.ts` — pack-qty resolution priority hardened (snapshot → override → vendor → Pipeline 1 → 1). Pipeline 1 no longer overrides explicit `pack_quantity`. `forceLiveData` flag added for live-cost recompute paths.

## Next session — start here
1. Confirm A vs B decision (currently leaning **A: next-snapshot first**).
2. Run backfill UPDATE on the 1,637 rows (Palm Springs, Mar 2 → Apr 13).
3. Reload COGS screen for week of Apr 13–19, verify Beginning Inventory jumps from $8,029.77 to ~$158k-derived value.
4. Open ticket on Theoretical Usage = $0.
5. Audit the save path: why is `cost_at_count` not being stamped at Palm Springs?

## Related context
- Plan file: `.lovable/plan.md` (Inner-Pack Counting Tier — Phase 1 hydration refactor is the prereq before any further count-math changes).
- Memory: `mem://architecture/inventory/count-history-integrity-standards` — denormalized snapshotting rule (`cost_at_count`) — this is exactly what's failing at PS.
