-- Re-open gap alerts that were closed by creating a duplicate brand item
-- instead of linking the vendor number onto the real brand item.
-- Scope guard: the number must still be on a live order guide AND still be
-- unclaimed by any live template (own item_number or approved mapping).
WITH unclaimed_guide_numbers AS (
  SELECT DISTINCT b.item_number
  FROM public.pfg_bid_items b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.inventory_items i
    WHERE i.location_id = b.location_id
      AND i.is_active
      AND i.item_number = b.item_number
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.brand_inventory_templates t
    WHERE t.status = 'live' AND t.item_number = b.item_number
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.brand_vendor_mappings m
    JOIN public.brand_inventory_templates t2 ON t2.id = m.brand_template_id
    WHERE m.vendor = 'pfg'
      AND m.vendor_item_id = b.item_number
      AND t2.status = 'live'
  )
)
UPDATE public.vendor_gap_alerts a
SET status = 'new',
    resolved_at = NULL
WHERE a.vendor_source = 'pfg'
  AND a.status IN ('promoted', 'resolved')
  AND a.item_number IN (SELECT item_number FROM unclaimed_guide_numbers);