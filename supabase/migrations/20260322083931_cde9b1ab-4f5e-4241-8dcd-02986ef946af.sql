ALTER TABLE public.inventory_product_groups
ADD COLUMN bom_menu_item_id UUID REFERENCES public.bom_menu_items(id) ON DELETE SET NULL;