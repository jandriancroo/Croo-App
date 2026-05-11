# AvT Cleanup Migration — Progress Tracker

_Last updated: 2026-05-11_

## Status snapshot
- **Safe to count tomorrow if unfinished?** ✅ Yes. The shipped fixes (A1 + recipe count-sheet fix + Hemet duplicate cleanup) are non-destructive and already live. Counting will work correctly. Remaining items improve AvT *reporting accuracy*, not the count workflow itself.
- **Can we finish tonight?** A2 alone is ~30–45 min if we go inline-on-AvT + per-location override (smallest scope). Full A2→A5 is ~2–3 hrs. Realistic to ship A2 tonight and pick up A3–A5 tomorrow.

---

## Shipped ✅
- **A1** — Recipe data-quality card on AvT report + recipe UI badges (archived / unpriced / missing ingredients).
- **Recipe count-sheet fix** — `is_recipe` propagated through 5 call sites; Balsamic now shows $5.90 instead of $0.
- **Hemet Balsamic duplicate** — orphan deleted, real count data reassigned to priced recipe.

## In progress 🚧
- **A2 — Unpriced Ingredients report + bulk fallback price**
  - [ ] Decide placement (inline AvT card vs standalone page vs both) — _waiting on user_
  - [ ] Decide fallback scope (brand default vs per-location vs per-row toggle) — _waiting on user_
  - [ ] Build query: brand items where resolved cost = 0 + recipes that depend on them
  - [ ] UI: list view with bulk-select + "set fallback price" action
  - [ ] Wire write path (brand_inventory_templates.fallback_price OR inventory_items.cost_per_unit)
  - [ ] Surface count of unpriced ingredients on AvT data-quality card

## Queued 📋
- **A3** — Recipe costing fix #2 (audit other "divide by yield" call sites that may still be wrong).
- **A4** — One-click "Deploy missing items to this location" button on AvT data-quality card.
- **A5** — Constraint pass #2: mirror the recipe orphan constraint on `brand_inventory_items` to prevent local items leaking to brand.

---

## Notes for tomorrow's count
- Hemet is clean — Balsamic will value at $5.90/batch.
- Any recipe still showing $0 on the count sheet = genuinely missing `cost_per_unit` AND no blueprint ingredients. Flag those to me and I'll add them to the A2 unpriced list.
- The A1 data-quality card on the AvT report will tell you which recipes have archived/unpriced/missing ingredients before you trust their numbers.
