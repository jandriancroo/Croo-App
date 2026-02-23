-- Add a JSONB column to store ALL usage rate mappings (not just one)
-- Format: [{ group_name, pos_categories, pos_items, usage_rate, rate_unit, manual_override }]
ALTER TABLE public.brand_inventory_templates 
ADD COLUMN IF NOT EXISTS usage_rate_mappings JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.brand_inventory_templates.usage_rate_mappings IS 
'Array of all usage rate mappings for this item: [{group_name, pos_categories, pos_items, usage_rate, rate_unit, manual_override}]';