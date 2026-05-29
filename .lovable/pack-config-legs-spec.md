# Per-Config Count Legs — Design Spec (Path B)

Status: **APPROVED — build behind `legs_enabled`, Hemet canary only**
Owner: Lovable
Canary: **Hemet** (source store on both Baby Spinach configs)
Pairs with: `.lovable/snapshot-immutability-spec.md`, `.lovable/pack-config-approval-spec.md`, `SHARED_WORKSPACE/brand_inventory/pack-config-lens.md`

## Pre-flight check (recorded 2026-05-29)

- Hemet in-progress count `240fe79f-3f51-433f-a054-daa980b51ec9` (started 2026-05-24)
  has two Baby Spinach `inventory_count_items` rows. **Both fully zero** (no
  `entered_cases` / `entered_inner_packs` / `entered_units` / `quantity`). No
  operator input is at risk when `legs_enabled` flips at Hemet. GM should still
  be told the 5-day-old count exists so they decide whether to discard or
  continue — not because of legs, but because it's stale.

---

## 0. Goal

Let one `inventory_items` row carry **N selected `brand_pack_configs`** at a
location, count each config independently, persist each independently across
save/exit/reopen, and freeze each independently on submit — without breaking
any of the existing single-config count paths, snapshot-immutability guarantees,
or downstream readers (COGS, AvT, exports, rate calc, reconciliation, backfill).

Non-goals: changing the cost source (still `cost_per_unit`), changing
`location_pack_selections`, rewriting `blended_price`, touching items without
multi-selection.

---

## 1. Schema — `inventory_count_item_legs`

```sql
CREATE TABLE public.inventory_count_item_legs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_item_id            uuid NOT NULL
                             REFERENCES public.inventory_count_items(id)
                             ON DELETE CASCADE,
  pack_config_id           uuid NOT NULL
                             REFERENCES public.brand_pack_configs(id),
  -- Raw operator input, per config, in that config's lanes:
  entered_cases            numeric,
  entered_inner_packs      numeric,
  entered_units            numeric,
  -- Derived, in the item's common_unit (lb, oz, ga, ea, ...):
  quantity_common          numeric NOT NULL DEFAULT 0,
  -- Snapshots — frozen on submit, mirror the cost_at_count contract:
  pack_quantity_at_count        numeric,   -- count_units_per_case from config at submit
  inner_pack_quantity_at_count  numeric,   -- inner_pack_quantity at submit
  cost_at_count                 numeric,   -- per-common-unit cost at submit (same value across all legs of one item)
  common_unit_at_count          text,      -- 'lb' / 'oz' / ... frozen
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_item_id, pack_config_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_count_item_legs TO authenticated;
GRANT ALL ON public.inventory_count_item_legs TO service_role;
ALTER TABLE public.inventory_count_item_legs ENABLE ROW LEVEL SECURITY;
-- Policies mirror inventory_count_items: access is gated through the parent
-- count_item_id → inventory_counts.location_id membership check.
```

Indexes: `(count_item_id)`, `(pack_config_id)` for backfill/audit.

### Why a child table (not JSONB on the parent)

- Lossless reload (the "10 lb = 1 case OR 4 bags" ambiguity from Path A
  goes away).
- Per-leg snapshot columns mirror the existing `cost_at_count` contract 1:1.
- Indexable, joinable, easy to audit and backfill.
- Parent row stays the public API for every existing reader (see §4).

---

## 2. Parent ↔ legs invariant

`inventory_count_items` stays the source of truth for **rolled-up** numbers.
Legs are the source of truth for **per-config inputs**.

On every save (in-progress and on submit), the writer is responsible for:

```
parent.quantity            = Σ legs.quantity_common              -- in common_unit
parent.entered_cases       = legs[default_config].entered_cases       -- back-compat
parent.entered_inner_packs = legs[default_config].entered_inner_packs -- back-compat
parent.entered_units       = legs[default_config].entered_units       -- back-compat
parent.cost_at_count       = legs[*].cost_at_count                    -- (all equal — see §3.3)
parent.pack_quantity_at_count       = legs[default_config].pack_quantity_at_count
parent.inner_pack_quantity_at_count = legs[default_config].inner_pack_quantity_at_count
```

Rules:

- **Single-config items don't get legs.** If `location_pack_selections` returns
  exactly one config for the item, we keep writing only the parent row — no leg
  row created. This keeps 99%+ of items on the existing code path and limits
  blast radius. (Verified: today only Baby Spinach at 4 stores has multi-select.)
- **Multi-config items get one leg per selected config.** Parent quantity =
  Σ legs.quantity_common. Parent lane fields (`entered_cases`, …) mirror the
  **default** config's leg so any reader that hasn't been taught about legs
  still gets a coherent (if partial) view.
- `quantity_common` per leg is computed using the same `getEffectivePackQty` +
  `inner_pack_quantity` rules already in `countItemValue.ts`, but scoped to
  that leg's `pack_config_id`.

### Common-unit guardrail

If a multi-config item has legs with mismatched `common_unit`:

- We **still write all legs** (no data loss).
- Parent `quantity` is **NOT** rolled up — set to NULL with a `quantity_rollup_blocked = true` marker (new bool column on parent, or sentinel; TBD in review).
- Count UI shows the per-config warning agreed in the prior pass; export/COGS treats the item as uncosted-rollup and surfaces the data warning instead of faking a sum. (This matches the clarification in the prior message: warn, don't block counting.)

---

## 3. Read/write paths affected

### 3.1 Count session — `src/components/inventory/InventoryCountSession.tsx`

Hydrate:
- Existing query at ~line 272 fetches parent rows. Add a parallel fetch of
  `inventory_count_item_legs` for the same `count_id`, indexed by
  `(item_id, pack_config_id)`.
- Selection source: `location_pack_selections` join (the Issue-7 fix already
  in scope). For each item:
  - 1 selected config → render today's 3-lane UI against the parent row (no leg).
  - N>1 selected configs → render nested sub-rows; each sub-row's inputs are bound
    to its leg, not the parent.

Save:
- For multi-config items, write **one row per leg** via upsert on
  `(count_item_id, pack_config_id)`, then recompute and write the parent
  invariants (§2) in the same transaction (RPC, see §6).
- For single-config items, code path is unchanged.

Edit (admin/locked count): legs are editable the same way the parent is; each
leg edit logs to `inventory_count_edit_log` with a new `pack_config_id`
column (additive, nullable for single-config edits — back-compat).

### 3.2 Valuation — `src/utils/countItemValue.ts` + `getEffectivePackQty.ts`

- Default path (single config / no legs present): **unchanged**. Snapshot-wins
  still holds.
- Multi-leg path: caller passes `legs[]` alongside the parent row.
  `calculateCountItemValue` becomes `Σ calculateLegValue(leg, item)`, where
  `calculateLegValue` is `countItemValue.ts`'s current math scoped to one
  leg's snapshots. Per-leg snapshot-wins is identical to today's per-row
  snapshot-wins — `pack_quantity_at_count` / `cost_at_count` / `inner_pack_quantity_at_count`
  are now read from the leg, not the parent.
- The fail-closed ladder (snapshot → override → count_units_per_case → pack_quantity → 1)
  is preserved per leg.

### 3.3 Cost-per-unit equality across legs

Per the prior decision (Issue 8): **every leg of one item carries the same
`cost_at_count`**, sourced from `inventory_items.cost_per_unit` for the
location at submit time. Per-config `cost_per_common_unit` is **not** used
for valuation. This guarantees that splitting a count into 1 case vs 4 bags
never changes total $.

### 3.4 View / review — `InventoryCountView.tsx`

Render nested sub-rows when legs exist; else today's flat row. Reuse the
same per-leg valuation helper so review screen $$ matches submit screen $$.

### 3.5 Export — `CountExportDialog.tsx` / `varianceReport.ts`

Add per-leg lines under the parent line. Parent line shows
`Σ quantity_common` + total $ (unless rollup blocked). CSV gets two new
columns: `pack_config_label`, `pack_config_id`. Single-config rows leave
those columns blank.

### 3.6 Rate calc — `src/utils/inventoryRateCalculation.ts`

Reads `quantity` off `inventory_count_items` today. Because parent.quantity
is maintained as Σ legs.quantity_common (§2), **no change required** for
single-unit items. For rollup-blocked items the rate calc skips (already
the behavior when quantity is NULL).

### 3.7 Reconciliation scan — `inventory-reconciliation-scan/index.ts`

Operates on parent rows and item_id dedup. Add: when merging duplicate
parent rows, **also re-parent any child legs** via `count_item_id` update
(or recreate). Add a guard test that legs are never orphaned by the dedupe
util.

### 3.8 Snapshot backfill — `inventory-snapshot-backfill/index.ts`

- Existing job is unchanged for parent rows.
- New companion job: backfill leg snapshots for any submitted-count leg
  with NULL `cost_at_count` / `pack_quantity_at_count`, using the same
  UI-parity resolution chain. Logs to `snapshot_backfill_log` with
  `source = 'legs_backfill'`.
- Single-config submitted counts created **before** legs ship never get
  legs (see §5) — backfill only touches legs that exist.

### 3.9 Step 4 nightly hardening (immutability spec §Step 4)

Job A (cost re-snapshot sweep) gets a second pass that scans
`inventory_count_item_legs` with the same NULL-cost predicate. Job B
(uncosted UI flag) is unchanged — it's keyed off `inventory_items.cost_per_unit`.

### 3.10 Submit / lock

`inventory_counts.status = 'completed'` triggers (server-side, see §6):
1. For every leg under the count, freeze `pack_quantity_at_count`,
   `inner_pack_quantity_at_count`, `cost_at_count`, `common_unit_at_count`
   from the live values at submit time.
2. Then freeze the parent row's snapshot columns from the default leg
   (back-compat for any reader not yet leg-aware).

After completion, both parent and legs are immutable to catalog edits —
same snapshot-wins rule, applied at both levels.

---

## 4. Backward compatibility contract

Every existing reader that joins `inventory_count_items` and ignores legs
keeps working because:

- Parent `quantity`, `entered_*`, `*_at_count` continue to be populated and
  internally consistent.
- For single-config items (the vast majority), nothing about the parent
  row changes at all — no legs are written.
- For multi-config items, the parent row reflects the **default config**
  for lane fields and the **sum** for `quantity`, so a leg-blind reader
  shows a plausible (if simplified) row.

Readers we explicitly upgrade in this work (must enumerate in PR):
`InventoryCountSession`, `InventoryCountView`, `CountExportDialog`,
`CountEditHistory`, `PeriodDetailPanel`, `COGSReport`, `useReportData`,
`varianceReport`, `inventory-reconciliation-scan`, `inventory-snapshot-backfill`,
`ai-assistant` (if it cites count rows).

---

## 5. Migration of existing counts

- **Submitted counts (historical):** **No legs created.** They keep their
  parent-row snapshots verbatim. Any future re-read uses parent snapshots
  (snapshot-wins). This preserves the 3,497-row Step 2 backfill guarantee
  bit-for-bit.
- **In-progress counts at lens-enabled stores at ship time:** On next save
  after deploy, the writer detects multi-config items and materializes
  legs from the current parent inputs — default config gets the existing
  lane values, the second config gets zeros. The user can then enter the
  second config's quantity before submit. **No silent re-valuation.**
- **Single-config items, ever:** Never get legs. Period.

Migration script: none required — purely runtime behavior. The DDL
migration adds the table, RLS, indexes, and (optionally) one helper RPC
(§6).

---

## 6. New RPC: `save_count_item_with_legs`

Single transactional entry point for the writer so parent/leg invariants
can't drift. Inputs: `count_id`, `item_id`, `storage_location_id`,
`legs: [{ pack_config_id, entered_cases, entered_inner_packs, entered_units, quantity_common }]`,
plus the freeze flag when called from submit.

Responsibilities:
1. Upsert parent `inventory_count_items` row.
2. Upsert all leg rows; delete legs whose `pack_config_id` is no longer
   in the input set.
3. Recompute parent aggregates per §2.
4. If `freeze=true` (submit path), copy live `cost_per_unit`,
   `count_units_per_case`, `inner_pack_quantity`, `common_unit` into the
   `*_at_count` snapshot columns on every leg and on the parent.

Single-config callers can keep writing parent rows directly without going
through the RPC (back-compat); the RPC is required only for multi-leg writes.

---

## 7. Rollout — Hemet canary

1. Migration + RPC + leg-aware writers ship behind a per-location flag:
   `locations.legs_enabled`. **Default false** at every store, including
   the other four lens-enabled stores. **Hemet flipped true at deploy.**
2. UI multi-row rendering only activates when both `lens_enabled = true`
   **and** `legs_enabled = true` for the current location. Other lens
   stores keep today's single-row behavior on Baby Spinach (case-default
   only, second selection ignored at render time) until promoted.
3. Hemet verification gate (must all pass before flipping the other four):
   - Start a count, enter 2 cases on the case leg and 3 bags on the bag
     leg. Parent `$` shows `(2×10 + 3×2.5) × $/lb`. Item subtotal = 27.5 lb.
   - Save & Exit. Reopen — both legs hydrate exactly as entered. **This is
     the failure mode Path A could not solve.**
   - Submit. Re-query both leg rows: `cost_at_count`,
     `pack_quantity_at_count`, `common_unit_at_count` all frozen and equal
     across legs on cost.
   - Edit the brand pack config's `count_units_per_case` post-submit. Re-open
     the completed count: leg quantities, $, and total are **unchanged**
     (snapshot-wins per leg).
   - COGS report, period rollup, export CSV, and variance report all show
     consistent numbers across the three surfaces.
4. Only after all four checks pass at Hemet, flip `legs_enabled = true` at
   Tuscaloosa → Palm Desert → Palm Springs (one at a time, eyeball each).

Rollback: flip `legs_enabled = false` at the location. Existing leg rows
stay in the DB (no destructive op); UI reverts to today's single-row
behavior. Parent row remains valid because §2 invariants were kept current.

---

## 8. Explicitly out of scope

- `blended_price` rewrite.
- Per-location pack-config picker UI (already shipped under approval spec).
- Auto-deactivating uncosted items.
- Changing `cost_at_count` to per-leg-cost variance — every leg of one item
  shares one cost by design.
- Schema changes to `inventory_counts` itself.
- Touching any single-config item's storage shape.

---

## 9. Memory updates owed (after ship)

- Update `mem://architecture/inventory/count-history-integrity-standards` —
  add legs to the immutability story; clarify parent vs leg snapshot
  contract.
- Update `mem://features/inventory/pos-mapping-system-standards` — n/a,
  but cross-link from the pack-config-lens doc.
- New leaf `mem://features/inventory/per-config-count-legs` — schema,
  invariants, single-vs-multi-config rule, rollout flag.

---

## 10. Open questions for your review

1. **Parent lane mirroring**: mirror the **default** config's leg into
   parent.entered_*, or write zeros and rely solely on `quantity`? Default
   chosen here for back-compat; flag if you'd rather null them out.
2. **`quantity_rollup_blocked`**: new bool column on the parent, or sentinel
   (`quantity IS NULL` + a warning row in a side table)? Bool is simpler.
3. **RPC vs client-side transaction**: RPC chosen above to keep invariants
   atomic. Confirm or push back.
4. **Edit log schema**: add `pack_config_id` (nullable) to
   `inventory_count_edit_log`, or write a sibling `inventory_count_leg_edit_log`?
   Inline column is lighter; sibling is cleaner separation.
5. **Step 4 Job A**: extend the existing function to sweep legs in the same
   run, or ship a sibling function `legs-snapshot-backfill`? Extending is
   one less moving part.

Answer these in review and I'll fold them in before any code lands.
