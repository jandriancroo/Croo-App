
-- Add storage_location_id to inventory_count_items for split-count support
ALTER TABLE public.inventory_count_items 
  ADD COLUMN storage_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL;

-- Update unique constraint: same item can have multiple entries per count if different storage locations
-- First drop existing unique constraint
ALTER TABLE public.inventory_count_items DROP CONSTRAINT IF EXISTS inventory_count_items_count_id_item_id_key;

-- Create new unique constraint including storage_location_id
CREATE UNIQUE INDEX inventory_count_items_count_item_location_key 
  ON public.inventory_count_items(count_id, item_id, COALESCE(storage_location_id, '00000000-0000-0000-0000-000000000000'));
