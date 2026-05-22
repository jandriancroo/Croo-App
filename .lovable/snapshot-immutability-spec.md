# Count History Immutability — Spec

Source of truth for the multi-step hardening of submitted inventory counts.
Owns the snapshot guard, the one-shot backfill, the two new tables (Step 3, TBD),
and the nightly hardening jobs.

---

## §0 — Framing (corrected, post-Step 2)

Before May 22, 2026: submitted inventory counts were **not** immutable. The
`pack_quantity_at_count` / `cost_at_count` snapshot fields existed but were only
populated on counts saved after the Apr 28 lock landed in `countItemValue.ts`.
~3,497 historical rows had NULL snapshots and would silently re-value whenever a
brand-level pack or cost changed. The Step 1 guard (snapshot-wins in
`getEffectivePackQty`) closed the future drift vector but couldn't help the
backlog.

Step 2 **created** count-history immutability for the first time — it didn't
merely enforce a pre-existing one.

---

## Step 1 — Snapshot-wins resolver guard  *(shipped)*

`src/utils/getEffectivePackQty.ts` priority chain is snapshot-first, fail-closed:

```
pack_quantity_at_count  →  pack_quantity_override  →  count_units_per_case  →  pack_quantity  →  1
```

`src/utils/countItemValue.ts` mirrors the same pattern for cost: if
`cost_at_count` is present, it wins absolutely, even when callers pass
`forceLiveData`.

**Effect:** any future catalog edit can never retroactively rewrite a submitted
count's valuation — provided the snapshot fields are populated.

---

## Step 2 — One-shot null-snapshot backfill  *(shipped May 22, 2026)*

Edge function: `supabase/functions/inventory-snapshot-backfill/index.ts`.
Audit table: `public.snapshot_backfill_log`.

Resolves pack qty and cost using the **exact same fallback chain the UI runs
today with `forceLiveData=false`** (Pipeline 1 conversion fallback included),
then freezes the resolved values into the NULL snapshot fields on every
submitted/completed count row.

### Actual results

| Metric | Value |
|---|---|
| Total NULL-snapshot rows processed | **3,497** |
| Rows where `pack_quantity_at_count` was written | 276 |
| Rows where `cost_at_count` was written | 3,247 |
| Rows overwriting an existing non-null snapshot | **0** (verified via `snapshot_backfill_log`) |
| Stragglers left as NULL (no resolvable cost) | **273** |
| COGS UI drift across 3 eyeballed periods | **0** |

### The 273 stragglers — intentional

Rows where the linked `inventory_items.cost_per_unit` was NULL at backfill time.
We deliberately did **not** write `0` because that would lie forever in the
snapshot. These rows continue to behave exactly as they did pre-backfill:
`calculateCountItemValue` falls back to live cost (also null) → $0 contribution
to COGS. They will be re-snapshotted by Step 4 Job A when cost becomes
resolvable.

### Why 3,497 ≠ 525 from the read-only preview query

Same population, different lens. The earlier read-only check flagged the 525
rows where a naive SQL freeze would produce a *different* number than the UI
shows today; 3,497 is the full set of NULL-snapshot rows the backfill touched
using UI-parity resolution. Both numbers are correct; they answer different
questions.

---

## Step 3 — Two new tables  *(TBD, awaiting design review)*

Reserved. Do not implement until reviewed.

---

## Step 4 — Nightly hardening jobs

Both run inside the existing 3 AM PST maintenance queue (see
`mem://architecture/maintenance-processing-system`). No new cron, no new
external scheduling.

### Job A — Cost re-snapshot sweep

**Goal:** retire the 273 stragglers (and any future equivalents) automatically
as costs become resolvable.

**Query:**
```sql
SELECT ici.id, ici.item_id, ii.cost_per_unit
FROM   inventory_count_items ici
JOIN   inventory_counts c  ON c.id = ici.count_id AND c.status <> 'in_progress'
JOIN   inventory_items   ii ON ii.id = ici.item_id
WHERE  ici.cost_at_count IS NULL
  AND  ii.cost_per_unit IS NOT NULL;
```

**Action:** freeze `cost_at_count = ii.cost_per_unit`, log to
`snapshot_backfill_log` with `source = 'nightly_resnapshot'` so it's
distinguishable from the May 22 one-shot.

**Properties:** idempotent by construction (only touches NULL fields).
Population shrinks monotonically.

### Job B — Uncosted-item UI flag

Passive surface — never auto-deactivates. Two render points:

1. **Count session row** — amber dot + tooltip *"No cost on file — count
   anyway, won't affect COGS"* whenever `inventory_items.cost_per_unit IS NULL`.
2. **Brand/Location inventory list** — small "Uncosted" pill in the same column
   family as existing vendor-health badges. Click opens the item drawer where
   the mapping/cost can be fixed.

**Optional rollup:** the nightly job writes a daily aggregate count of
uncosted-active items into `vendor_gap_alerts` (or a sibling alert type) so
ops sees it in the same place vendor gaps already surface.

**Explicitly rejected:** auto-deactivating uncosted items. Reasons documented
in chat 2026-05-22 — punishes the wrong layer, kills recipes via cascade, and
breaks the "count first, cost later" workflow.

---

## Sequencing

1. ✅ Step 1 — snapshot-wins guard (shipped)
2. ✅ Step 2 — one-shot backfill (shipped May 22, 2026)
3. ⏸ Step 3 — two new tables (design review with Claude before code)
4. ⏳ Step 4 — Jobs A + B (ship together as one nightly-hardening drop, after Step 3 lands)

---

## Memory updates owed (after Step 4 ships)

- Update `mem://architecture/inventory/count-history-integrity-standards` —
  add Step 2 backfill + Step 4 nightly resnapshot to the immutability story.
- New leaf `mem://features/inventory/uncosted-item-flagging` — Job B render
  rules and the explicit no-auto-deactivate decision.
