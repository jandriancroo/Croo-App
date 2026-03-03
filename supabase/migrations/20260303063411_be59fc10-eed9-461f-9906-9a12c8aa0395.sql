-- Add per-shortcut counting unit overrides to inventory_item_locations
ALTER TABLE public.inventory_item_locations 
  ADD COLUMN IF NOT EXISTS count_by text NOT NULL DEFAULT 'inherit',
  ADD COLUMN IF NOT EXISTS pan_enabled_keys text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pack_quantity_override integer DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.inventory_item_locations.count_by IS 'Counting mode override: inherit (use item default), cases_only, units_only, cases_and_units';
COMMENT ON COLUMN public.inventory_item_locations.pan_enabled_keys IS 'Override which pan sizes are enabled for this shortcut spot (NULL = inherit from item)';
COMMENT ON COLUMN public.inventory_item_locations.pack_quantity_override IS 'Override pack quantity for this shortcut spot (NULL = inherit from item)';