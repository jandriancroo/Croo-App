-- Add manual pack quantity override to inventory items
-- When set, this takes precedence over the PFG pack_quantity during counts
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS pack_quantity_override integer DEFAULT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN public.inventory_items.pack_quantity_override IS 'Manual override for pack quantity (units per case). When set, takes precedence over PFG-synced pack_quantity.';