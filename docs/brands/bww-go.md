# Buffalo Wild Wings GO

- **Brand ID:** `164ed861-d3bd-426d-8993-0403aa390634`
- **POS:** _TBD — not yet integrated_
- **Status:** 🔴 Setup — brand exists, no POS sync wired

---

## 1. POS Integration

_Not yet selected._ Candidates depend on franchisor mandate (likely NCR Aloha or Oracle Symphony for BWW corporate; confirm with operator).

## 2. Sales Cache Coverage

❌ No rows in `sales_cache` for this brand yet.

## 3. Data Cubes & Widgets

❌ Dashboards will render empty until a POS sync is added.

## 4. Labor Source

Options:
- **CrooHQ punch clock** (`source='punch_clock'`) — works today, no POS dependency.
- Native POS labor sync once POS is chosen.

## 5. Inventory & Recipes

Not started. Brand Catalog seed required before any deployment.

## 6. Known Gaps & Roadmap

- [ ] Decide POS (Aloha / Symphony / other).
- [ ] Build sync edge function on the Mailroom pattern (dual-write to `sales_cache` with `pos_source` tag + per-POS raw cache table).
- [ ] Seed Brand Catalog.
- [ ] Confirm labor strategy.

**Last updated:** 2026-05-27
