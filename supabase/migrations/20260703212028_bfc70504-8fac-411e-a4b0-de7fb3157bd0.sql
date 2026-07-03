
-- Manual walk-the-shelf ordering for Lite inventory items.
-- Nullable on purpose: NULL = "use alphabetical fallback".
ALTER TABLE public.lite_inventory_items
  ADD COLUMN IF NOT EXISTS display_order integer;

-- Composite index for the common read path:
--   WHERE location_id = ? AND is_active = true
--   ORDER BY storage_id, display_order NULLS LAST, name
CREATE INDEX IF NOT EXISTS idx_lite_items_location_storage_order
  ON public.lite_inventory_items (location_id, storage_id, display_order NULLS LAST, name)
  WHERE is_active = true;
