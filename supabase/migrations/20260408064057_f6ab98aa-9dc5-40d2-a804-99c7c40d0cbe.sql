
-- Add brand_id column to inventory_product_groups
ALTER TABLE public.inventory_product_groups
ADD COLUMN brand_id UUID REFERENCES public.brands(id);

-- Index for efficient brand-level lookups
CREATE INDEX idx_inventory_product_groups_brand_id ON public.inventory_product_groups(brand_id);
