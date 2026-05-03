-- Fix: inactive ghost rows must not squat vendor SKUs.
-- The previous unique index reserved item_number across all rows (active or not),
-- which silently blocked deploy-location-inventory from stamping inherited SKUs
-- onto active Pouch rows when an inactive Can/DC twin still held the same SKU.
DROP INDEX IF EXISTS public.idx_inventory_items_location_item_number;

CREATE UNIQUE INDEX idx_inventory_items_location_item_number
  ON public.inventory_items (location_id, item_number)
  WHERE item_number IS NOT NULL AND is_active = true;