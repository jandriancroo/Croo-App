-- Step 1: Add status column to brand_inventory_templates (draft/live/archived lifecycle)
ALTER TABLE public.brand_inventory_templates 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live';

-- Add index for filtering by status
CREATE INDEX IF NOT EXISTS idx_brand_inventory_templates_status 
ON public.brand_inventory_templates (brand_id, status);

-- Step 2: Add brand_item_id to inventory_items so locations reference the brand catalog
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS brand_item_id uuid REFERENCES public.brand_inventory_templates(id) ON DELETE SET NULL;

-- Add index for looking up location items by brand reference
CREATE INDEX IF NOT EXISTS idx_inventory_items_brand_item_id 
ON public.inventory_items (brand_item_id) WHERE brand_item_id IS NOT NULL;