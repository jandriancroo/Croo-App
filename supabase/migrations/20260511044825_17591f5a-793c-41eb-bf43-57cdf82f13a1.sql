ALTER TABLE public.recipe_blueprints
ADD CONSTRAINT brand_recipes_must_have_null_location
CHECK (
  (location_id IS NULL AND brand_id IS NOT NULL)
  OR location_id IS NOT NULL
);