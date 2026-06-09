# Ticket: Co-SKU Audit Merge in Pack Config Seeder

**Status:** Open, non-blocking
**Filed:** 2026-06-09
**Owner:** next inventory session
**Priority:** Low (audit hygiene; no functional impact)

## Problem

The DB has a partial unique index `uniq_brand_pack_configs_proposed_structure`
on `(brand_template_id, outer_qty, COALESCE(inner_qty,0), common_unit)
WHERE status='proposed'` — mirror of the approved-side rule.

The seeder's new dedup logic (keyed on `(template, vendor, vendor_item_id,
count_units_per_case, common_unit)`) correctly treats two SKUs mapped to the
same template as distinct audit candidates. But when a second SKU resolves to
the **same pack structure** as the first, the DB rejects the second insert.

In the most recent live run: **3 of 47 proposals were silently dropped** to
the `skipped_proposals` bucket for this reason. The surviving proposed row
represents that structure, but its `source_evidence` only references the
first SKU — the co-SKU lineage is lost.

## Why not just drop the unique index

Rejected. Diverges from the approved-side rule. Would allow two `proposed`
twins per structure, recreating exactly the cognitive load the seeder was
built to eliminate (which one to approve?).

## Fix

Inside `supabase/functions/pack-config-seeder/index.ts`, in the insert loop,
catch the unique-violation error (or pre-check `existingByStructure`) and
**merge** instead:

```ts
// pseudocode
const existing = await findProposedBySameStructure(c);
if (existing) {
  const coSkus = existing.source_evidence?.co_skus ?? [];
  coSkus.push({
    vendor: c.vendor,
    vendor_item_id: c.vendor_item_id,
    observed_at: new Date().toISOString(),
    raw_pack_string: c.raw_pack_string,
    cost_per_case: c.cost_per_case,
  });
  await supabase
    .from('brand_pack_configs')
    .update({ source_evidence: { ...existing.source_evidence, co_skus: coSkus } })
    .eq('id', existing.id);
  log('co_sku_merged');
  continue;
}
```

Backfill the 3 currently-collapsed rows from the most recent run's
`skipped_proposals` log when shipping.

## Acceptance

- Re-running the seeder on a fixture with two same-structure SKUs produces
  exactly one `proposed` row with `source_evidence.co_skus.length === 1`
  (the second SKU).
- No new DB index changes.
- Approval UI continues to render normally (it ignores `co_skus`).
