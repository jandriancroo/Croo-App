
ALTER TABLE public.inventory_product_groups 
ADD COLUMN IF NOT EXISTS blueprint_id UUID REFERENCES public.recipe_blueprints(id) ON DELETE SET NULL;
