-- Drop the FK constraint so vendor_item_id can reference brand templates
ALTER TABLE public.recipe_blueprint_ingredients
  DROP CONSTRAINT recipe_blueprint_ingredients_vendor_item_id_fkey;