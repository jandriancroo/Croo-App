-- Add remap_status to inventory_items for tracking items needing remapping
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS remap_status text DEFAULT NULL;

-- Add index for quickly finding items that need remapping
CREATE INDEX IF NOT EXISTS idx_inventory_items_remap_status 
ON public.inventory_items (location_id, remap_status) 
WHERE remap_status IS NOT NULL;

COMMENT ON COLUMN public.inventory_items.remap_status IS 'null = normal, needs_remap = flagged for remapping, remapped = successfully remapped';