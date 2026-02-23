
-- Expand brand_inventory_templates with additional deployable fields
ALTER TABLE public.brand_inventory_templates
  ADD COLUMN IF NOT EXISTS storage_location_name text,
  ADD COLUMN IF NOT EXISTS usage_rate numeric,
  ADD COLUMN IF NOT EXISTS usage_rate_unit text,
  ADD COLUMN IF NOT EXISTS usage_rate_manual_override boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS product_group_name text,
  ADD COLUMN IF NOT EXISTS product_group_pos_categories text[],
  ADD COLUMN IF NOT EXISTS product_group_pos_items text[],
  ADD COLUMN IF NOT EXISTS pan_overrides jsonb;
