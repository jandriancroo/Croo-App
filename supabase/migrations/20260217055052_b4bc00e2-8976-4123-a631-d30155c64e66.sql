-- Add pos_items column for individual menu item-level mapping
ALTER TABLE public.inventory_product_groups
ADD COLUMN pos_items text[] DEFAULT '{}'::text[];