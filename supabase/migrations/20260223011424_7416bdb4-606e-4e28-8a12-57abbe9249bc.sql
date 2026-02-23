
-- Add display_order column to inventory_items for persistent item ordering within locations
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- Create an index for efficient ordering queries
CREATE INDEX IF NOT EXISTS idx_inventory_items_display_order 
ON public.inventory_items (location_id, storage_location_id, display_order);
