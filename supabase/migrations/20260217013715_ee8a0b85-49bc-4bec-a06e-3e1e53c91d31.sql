-- Add POS category mapping to product groups so we know which sales categories to sum
ALTER TABLE public.inventory_product_groups 
ADD COLUMN pos_categories text[] DEFAULT '{}';

-- Add comment for clarity
COMMENT ON COLUMN public.inventory_product_groups.pos_categories IS 'QUBeyond product_mix category names that map to this product group for units-sold calculation';
