-- Backfill inner_pack_quantity_at_count for Tuscaloosa May Month End in-progress count
-- (count_id 53621171-d8ad-4f56-986e-e89d9db3cdad)
-- Same fix as the 2026-06-01 lens-derived inner factor backfill, but scoped to this
-- in-progress count which was started before the writer patch and missed by the original
-- backfill (which intentionally skipped in_progress counts).

WITH lens AS (
  SELECT
    ici.id,
    COALESCE(bpc.inner_qty, t.pack_override_inner_qty) AS new_ipq
  FROM public.inventory_count_items ici
  JOIN public.inventory_items ii ON ii.id = ici.item_id
  LEFT JOIN public.brand_inventory_templates t ON t.id = ii.brand_item_id
  LEFT JOIN public.brand_pack_configs bpc
    ON bpc.brand_template_id = ii.brand_item_id
   AND bpc.status = 'approved'
  WHERE ici.count_id = '53621171-d8ad-4f56-986e-e89d9db3cdad'
    AND ici.inner_pack_quantity_at_count IS NULL
    AND COALESCE(ici.quantity, 0) > 0
)
UPDATE public.inventory_count_items ici
SET inner_pack_quantity_at_count = lens.new_ipq
FROM lens
WHERE ici.id = lens.id
  AND lens.new_ipq IS NOT NULL
  AND lens.new_ipq > 0;