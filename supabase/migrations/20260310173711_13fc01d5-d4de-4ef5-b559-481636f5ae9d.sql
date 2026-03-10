-- Add unique constraint on (location_id, item_number) to prevent duplicate inventory items
-- Only applies where item_number is NOT NULL (manual items without vendor codes are fine)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_location_item_number 
  ON public.inventory_items (location_id, item_number) 
  WHERE item_number IS NOT NULL;