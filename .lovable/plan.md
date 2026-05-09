## Inner-Pack Counting Tier — Cleanup & Build Plan

Picks up the deferred brief (`/mnt/documents/inner-pack-counting-tier.md`). Scope: add a third counting tier (Case → Inner Pack → Unit), fix the hydration drift it would otherwise amplify, and backfill 15 brand-catalog items.

### Goals
- Operators can count partial cases as sleeves/inner packs/bundles instead of "0 cases" or 3,000 individual liners.
- Zero regression for items where `inner_pack_quantity IS NULL` (today's behavior).
- Kill the Apr 30 Palm Springs $270 pan reverse-derivation drift as part of the same work.
- Costing, vendor ordering, PFG sync, AvT, pan layer all untouched.

---

### Phase 1 — Hydration Contract Refactor (do this FIRST, ship alone)

This is the unlock. Inner packs cannot land safely on top of a hydration path that reverse-derives `entered_units` from `quantity − cases × pack_qty`.

**Rule:** `entered_cases`, `entered_units`, `pan_units` (and later `entered_inner_packs`) are the source of truth. `quantity` is a derived denormalized total, recomputed only on save, never read at hydrate.

Changes:
- `src/components/inventory/InventoryCountSession.tsx` + `InventoryCountView.tsx`: load each input field directly from `inventory_count_items` and `pan_inputs`. Remove any `quantity − …` math from the load path.
- `src/utils/countItemValue.ts`: confirm valuation reads explicit fields; only `quantity` math at save time.
- Add a one-time validator (dev-only console log behind a flag) that recomputes expected `quantity` on hydrate and warns on mismatch. Use it to sweep existing 2-tier counts before Phase 2.

**Acceptance:** Apr 30 Palm Springs Edit Count opens with $270 drift gone, all other location counts unchanged.

---

### Phase 2 — Schema

Single migration:
- `inventory_items.inner_pack_quantity INT NULL` (brand catalog + local mirror — same dual-scope as `pack_quantity`).
- `inventory_count_items.entered_inner_packs INT NULL`
- `inventory_count_items.inner_pack_quantity_at_count INT NULL` (Phase 3 snapshot lock pattern, mirrors `pack_quantity_at_count`).

No backfill in this migration — values stay null, behavior unchanged.

---

### Phase 3 — Save-Time Formula + Snapshot

In count save path:
```
quantity = entered_cases × pack_quantity
         + entered_inner_packs × inner_pack_quantity
         + entered_units
         + pan_units
```
Write `inner_pack_quantity_at_count = inner_pack_quantity` at save (same place `pack_quantity_at_count` is captured). Null-safe: if `inner_pack_quantity IS NULL`, the inner-pack term is 0 and the formula collapses to today's behavior.

---

### Phase 4 — Count UI: Third Input

Conditionally render a third numeric input in the count session row when `inner_pack_quantity IS NOT NULL`. Contextual label driven by item category / common name:
- Cups, lids → "Sleeves"
- Pizza boxes, to-go bags, napkins → "Bundles"
- Gloves, condiment packets → "Inner Boxes"
- Default fallback → "Inner Packs"

Place between Cases and Units. Mobile-first: same pill styling as existing inputs, no layout regression on iPhone widths. Field hidden entirely for null items so the 95% case stays a 2-tier UI.

---

### Phase 5 — Brand-Catalog Backfill (15 items)

Backfill at brand level so all locations inherit (per the brand-centric manifesto). Confirmed values from the brief:

| Item | inner_pack_quantity |
|---|---|
| Regular Paper Cups (24 oz) | 50 |
| Small Paper Cups (16 oz) | 50 |
| 1/2 Pizza Boxes | 50 |
| 11" Pizza Boxes | 25 |
| 14" Pizza Boxes | 25 |
| Portion Cups (2500) | 250 |
| Gloves S/M/L/XL | 100 |

TBD (need physical confirmation before writing): Sugar / Red Pepper / Parmesan packets, To-Go Bags, 24 oz Coke Cups, Water Cups, Cold Cup Lids, Napkins, Pizza Liners.

Excluded: beer/wine 24-packs (SKU concern, not a counting concern).

Done as a SQL migration (idempotent, matches by brand + canonical item name).

---

### Phase 6 — Verification

- Apr 30 Palm Springs Edit Count: drift is gone (already validated in Phase 1, re-verify post-Phase 4).
- Run inventory-reconciliation-scan for Palm Springs current period — counts in line, no orphan rows.
- Take one fresh count at a backfilled item using all three tiers; confirm `quantity` math + valuation + AvT are all correct.

---

### Memory updates (after build)
- New: `mem://architecture/inventory/count-input-tier-contract` — explicit-fields-only hydration rule.
- Update: `mem://architecture/inventory/count-history-integrity-standards` — add `inner_pack_quantity_at_count` to denormalized snapshot list.
- Update: `mem://features/inventory/counting-session-logic` — third tier + conditional render rule.

---

### Sequencing recommendation

Ship **Phase 1 alone first** (hydration refactor is the highest-risk, lowest-visible change — needs a clean week of count sessions to validate). Then Phases 2–4 together as the inner-pack feature drop. Phase 5 backfill last so the UI is proven before items start showing the third input.

### Out of scope
- Vendor ordering / PFG sync changes
- Cost-per-oz math
- Pan / Cambro layer changes
- Beer/wine 6-pack SKU restructuring
