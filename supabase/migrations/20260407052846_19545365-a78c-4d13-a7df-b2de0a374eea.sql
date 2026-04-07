ALTER TABLE public.recipe_blueprint_ingredients
  ADD CONSTRAINT recipe_blueprint_ingredients_vendor_item_id_fkey
  FOREIGN KEY (vendor_item_id) REFERENCES public.brand_inventory_templates(id);