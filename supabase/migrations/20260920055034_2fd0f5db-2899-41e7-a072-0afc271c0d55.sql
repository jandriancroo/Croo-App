-- 1. No more silent 'manual' default: an omission must land as NULL (visibly unknown).
ALTER TABLE public.inventory_items ALTER COLUMN vendor_source DROP DEFAULT;

-- 2. Backfill contradicting rows only.
--    a) brand_vendor_mappings on the row's brand_item_id (PFG wins when both exist)
WITH tgt AS (
  SELECT i.id,
         CASE WHEN bool_or(lower(m.vendor) = 'pfg') THEN 'pfg'
              WHEN bool_or(lower(m.vendor) IN ('produce_alliance','pa')) THEN 'produce_alliance'
         END AS derived
  FROM public.inventory_items i
  JOIN public.brand_vendor_mappings m ON m.brand_template_id = i.brand_item_id
  WHERE (i.vendor_source IS NULL OR i.vendor_source = 'manual')
  GROUP BY i.id
)
UPDATE public.inventory_items i
SET vendor_source = t.derived
FROM tgt t
WHERE i.id = t.id AND t.derived IS NOT NULL
  AND (i.vendor_source IS NULL OR i.vendor_source = 'manual');

--    b) item_number matching that same location's PFG bid guide
UPDATE public.inventory_items i
SET vendor_source = 'pfg'
WHERE (i.vendor_source IS NULL OR i.vendor_source = 'manual')
  AND i.item_number IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.pfg_bid_items b
    WHERE b.item_number = i.item_number
      AND b.location_id = i.location_id
  );

--    c) pa_item_id matching that location's Produce Alliance catalog
UPDATE public.inventory_items i
SET vendor_source = 'produce_alliance'
WHERE (i.vendor_source IS NULL OR i.vendor_source = 'manual')
  AND i.pa_item_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.pa_catalog_items c
    WHERE c.pa_item_id = i.pa_item_id
      AND c.location_id = i.location_id
  );

-- 3. One confirmed mislabel: Palm Springs "Blaze Red Sauce Can" is PFG-only.
--    pa_item_id intentionally left in place for a separate review.
UPDATE public.inventory_items i
SET vendor_source = 'pfg'
WHERE i.item_number = '611957'
  AND i.pa_item_id = '20916'
  AND i.vendor_source = 'produce_alliance'
  AND i.location_id IN (SELECT id FROM public.locations WHERE name = 'Palm Springs');