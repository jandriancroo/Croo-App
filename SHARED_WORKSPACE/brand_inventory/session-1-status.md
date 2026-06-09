# Brand Inventory — Session 1 Status

**Date:** 2026-06-09
**Scope:** Pack Config Approval Phase 1 — seeder hardening & first clean batch

---

## Phase 1 — PFG bid cache

- PFG bid pull landed in `pfg_bid_items`; territory-aware, refresh audited via `pfg_refresh_audit`.
- Confirmed source-of-truth precedence for pack strings: bid first, order fallback.

## Phase 2 — Dry-run findings

Initial dry-run surfaced **47 proposals** but with multiple structural defects:

1. **Parser bug** — `1000/1 CT` vs `1/1000 CT` parsed as two valid shapes producing identical `count_units_per_case`, generating phantom duplicates of already-approved configs (e.g. Plastic Spoons 1002342).
2. **Weak dedup** — original `candidateDedupKey` was `(template, outer, inner, common_unit)`, no fallback to `count_units_per_case` or SKU; silently emitted "new" proposals that were just casing variants of approved rows (`CASE`/`case`, `ga`/`gal`, `gm`/`g`). 25 of 47 (53%) were this class.
3. **`outer_type = 'CASE'`** — seeder hard-coded uppercase literal; UI preset list is lowercase, so the dropdown fell through to "Add other…" and the word `CASE` rendered next to the qty.
4. **Evidence schema drift** — seeder wrote nested `{cost_basis, parsed_pack, final_pack, vendor_item_id}`; UI (`BrandPackConfigApprovals.tsx`) reads legacy flat shape (`sku`, `packString`, `costPerCase`, `territory`). All new rows displayed broken headers / "no source case price" regardless of actual data.

## Seeder refactor (shipped)

`supabase/functions/pack-config-seeder/index.ts`:

- Lowercased all 4 `'CASE'` literals → `'case'`.
- Added flat aliases (`sku`, `packString`, `costPerCase`, `territory`) alongside structured fields in `source_evidence`.
- New dedup key: `(template_id, vendor, vendor_item_id, count_units_per_case, common_unit)` — preserves SKU-level audit trail while collapsing pure casing/structural variants.
- Legacy fallback: stamps existing approved rows with `vendor_item_id` the first time the seeder sees a matching vendor row (data hygiene).
- Migration `20260609004457` deleted 47 stale proposals from prior schema.

## Live run results

- **44 proposals inserted** (out of 47 candidates).
- **407 ledger rows** upserted to `location_pack_seen_ledger`.
- **56 templates** flagged `needs_deduplication` (multi-vendor mappings).
- **248 reports** with `no_source_evidence`.
- **0 parse errors.**

### Why 44 not 47

DB-level partial unique index `uniq_brand_pack_configs_proposed_structure`
collapsed 3 second-SKU-same-structure cases. Not data loss — surviving
proposal still represents the structure. Co-SKU audit lineage missing; filed
as [co-sku-audit-merge.md](./co-sku-audit-merge.md) (non-blocking).

## Smoke test (2026-06-09)

Random new proposal `d94a96fd-…` (PFG SKU 803282, `24/330 ML`, $23.24/case):

- ✅ `outer_type = 'case'` (lowercase)
- ✅ `sku` = `vendor_item_id` = `"803282"`
- ✅ `packString = "24/330 ML"`
- ✅ `costPerCase = 23.24`
- ✅ `territory = null` (bid-source, expected)
- ✅ Nested `cost_basis` / `parsed_pack` / `final_pack` intact

UI will render header cleanly and pack-structure dropdown shows `case`, not `CASE`.

## Session 2 priorities

1. **PFG sync ticket** ([_tickets/pfg-orders-sync-breakage.md](../_tickets/pfg-orders-sync-breakage.md)) — top of queue.
2. Approval pass through the 44 queued proposals (founder).
3. Co-SKU audit merge patch when bandwidth allows.
