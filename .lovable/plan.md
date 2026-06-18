## Goal

Stop overloading `pa_catalog_items.pa_item_id` with three different PA identifier systems. Add explicit columns for `pa_product_id`, `master_product_code`, `master_product_id`, backfill from the freshest source for each, then re-run the stale-mapping classification against all three columns. After that, standardize `brand_vendor_mappings.vendor_item_id` (for vendor='produce_alliance') on `pa_product_id` going forward.

Nothing destructive runs in this phase. You'll see the schema diff and the backfill SQL, approve them, then we execute and re-classify.

---

## Phase 1 — Schema diff (migration, requires approval)

```sql
ALTER TABLE public.pa_catalog_items
  ADD COLUMN IF NOT EXISTS pa_product_id        text,
  ADD COLUMN IF NOT EXISTS master_product_code  text,
  ADD COLUMN IF NOT EXISTS master_product_id    text;

CREATE INDEX IF NOT EXISTS idx_pa_catalog_pa_product_id
  ON public.pa_catalog_items (pa_product_id);
CREATE INDEX IF NOT EXISTS idx_pa_catalog_master_product_code
  ON public.pa_catalog_items (master_product_code);
CREATE INDEX IF NOT EXISTS idx_pa_catalog_master_product_id
  ON public.pa_catalog_items (master_product_id);

COMMENT ON COLUMN public.pa_catalog_items.pa_product_id IS
  'PA "Product ID" — the value PA prints on pricing sheets, order confirmations, and invoices. Backfilled from pa_orders.items. AUTHORITATIVE resolution key.';
COMMENT ON COLUMN public.pa_catalog_items.master_product_code IS
  'PA masterProductCode — guide ID returned by current-prices API. Supporting reference only.';
COMMENT ON COLUMN public.pa_catalog_items.master_product_id IS
  'PA masterProductId — internal DB primary key. Supporting reference only.';
COMMENT ON COLUMN public.pa_catalog_items.pa_item_id IS
  'LEGACY — currently holds masterProductCode. Kept for backward compatibility; do not use as resolution key.';
```

No RLS / GRANT changes (table already exists with policies). `pa_item_id` is left untouched — preserves any existing references during transition.

---

## Phase 2 — Resync code patch

In `supabase/functions/produce-alliance-service/index.ts`, `fetchCurrentPricesCatalog` (line 1099-1118) writes the two fields it already has from the current-prices API:

```ts
allItems.push({
  pa_item_id: guideId || internalId,       // unchanged (legacy)
  pa_internal_id: internalId || null,      // unchanged (legacy)
  master_product_code: guideId || null,    // NEW
  master_product_id: internalId || null,   // NEW
  description: name,
  pack_size: parsedPack.packSize,
  category: 'Produce',
  unit_price: item.pricePerCase != null ? Number(item.pricePerCase) : null,
});
```

And in both `handleSaveCatalog` (line 2647) and `handleScrapeCatalogLive` upsert (line 3286), add the two new fields to the upsert payload. `pa_product_id` is **not** set by the resync — it comes from Phase 3.

---

## Phase 3 — Backfill `pa_product_id` from `pa_orders`

Most-recent-order-per-(location, master_product_code) wins. Order lines carry both `master_product_code` and `pa_product_id` together, so this is a clean join.

```sql
WITH ranked AS (
  SELECT
    po.location_id,
    (it->>'master_product_code') AS mpc,
    (it->>'pa_product_id')       AS ppid,
    po.order_date,
    ROW_NUMBER() OVER (
      PARTITION BY po.location_id, (it->>'master_product_code')
      ORDER BY po.order_date DESC
    ) AS rn
  FROM pa_orders po,
       jsonb_array_elements(po.items) it
  WHERE it->>'master_product_code' IS NOT NULL
    AND it->>'pa_product_id'       IS NOT NULL
)
UPDATE pa_catalog_items pc
SET pa_product_id       = r.ppid,
    master_product_code = COALESCE(pc.master_product_code, pc.pa_item_id),
    master_product_id   = COALESCE(pc.master_product_id, pc.pa_internal_id)
FROM ranked r
WHERE r.rn = 1
  AND pc.location_id = r.location_id
  AND pc.pa_item_id  = r.mpc;     -- pa_item_id currently == masterProductCode
```

Also seeds `master_product_code` / `master_product_id` for any existing rows that pre-date the resync patch.

---

## Phase 4 — Re-run stale classification (dry-run)

A PA mapping is now "stale" only when its `vendor_item_id` matches **none** of these for the freshest catalog row of its template:

- `pa_catalog_items.pa_product_id`
- `pa_catalog_items.master_product_code`
- `pa_catalog_items.master_product_id`

I'll show the new DELETE / KEEP buckets and the per-template breakdown. No writes.

---

## Phase 5 — Going-forward standard

- `brand_vendor_mappings.vendor_item_id` for `vendor='produce_alliance'` = `pa_product_id` (PA Product ID), period.
- `master_product_code` / `master_product_id` are supporting reference columns; never the resolution key.
- `autoSeedPaVendorMappings` updated in a later pass to insert the `pa_product_id` (not the masterProductCode) when seeding new mappings.

---

## Approval checkpoints

1. Approve the migration in Phase 1.
2. After it runs, approve the resync code patch (Phase 2) and the backfill UPDATE (Phase 3).
3. Review Phase 4 dry-run before any DELETE.
4. Phase 5 code change happens in a follow-up turn.