-- Add pan_sizes column to inventory_items to store pan-based unit configurations
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS pan_sizes jsonb DEFAULT NULL;

COMMENT ON COLUMN public.inventory_items.pan_sizes IS 
'Stores pan/cambro size unit equivalents for prepped item counting. 
Format: { "enabled": true, "baseline_size": "full_pan", "baseline_units": 48, "sizes": { "full_pan": 48, "half_pan": 24, ... } }';
