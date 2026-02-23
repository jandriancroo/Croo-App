
-- Add recipe data columns to brand_inventory_templates
ALTER TABLE public.brand_inventory_templates
  ADD COLUMN IF NOT EXISTS is_recipe boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipe_yield_qty numeric,
  ADD COLUMN IF NOT EXISTS recipe_yield_unit text,
  ADD COLUMN IF NOT EXISTS recipe_ingredients jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS vendor_source text,
  ADD COLUMN IF NOT EXISTS item_number text,
  ADD COLUMN IF NOT EXISTS pa_item_id text;

-- Add source tracking for auto-created items during deploy
-- (using existing needs_review + review_reason on brand_inventory_deployments)
