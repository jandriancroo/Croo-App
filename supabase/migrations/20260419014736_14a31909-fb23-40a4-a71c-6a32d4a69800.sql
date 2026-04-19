-- Backfill vendor_source on existing inventory_items that have a vendor ID stamped
-- but lost their vendor_source label. Without this, deploy/sync logic that filters
-- on vendor_source = 'pfg' (e.g. PFG cost-backfill loop) silently skips them and
-- the items end up with $0 cost.
UPDATE public.inventory_items
SET vendor_source = 'pfg'
WHERE is_active = true
  AND (vendor_source IS NULL OR vendor_source = '')
  AND item_number IS NOT NULL
  AND pa_item_id IS NULL;

UPDATE public.inventory_items
SET vendor_source = 'produce_alliance'
WHERE is_active = true
  AND (vendor_source IS NULL OR vendor_source = '')
  AND pa_item_id IS NOT NULL
  AND item_number IS NULL;