-- Add is_recipe flag to inventory_items
ALTER TABLE public.inventory_items
ADD COLUMN is_recipe boolean NOT NULL DEFAULT false;

-- Add recipe yield info to inventory_items (for recipe items)
ALTER TABLE public.inventory_items
ADD COLUMN recipe_yield_qty numeric DEFAULT NULL,
ADD COLUMN recipe_yield_unit text DEFAULT NULL;

-- Create recipe ingredients table
CREATE TABLE public.inventory_recipe_ingredients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  ingredient_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL,
  unit text NOT NULL DEFAULT 'ea',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipe_item_id, ingredient_item_id)
);

-- Enable RLS
ALTER TABLE public.inventory_recipe_ingredients ENABLE ROW LEVEL SECURITY;

-- RLS: authenticated users with location access can manage recipe ingredients
CREATE POLICY "Authenticated users can view recipe ingredients"
  ON public.inventory_recipe_ingredients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_items i
      JOIN public.user_locations ul ON ul.location_id = i.location_id
      WHERE i.id = recipe_item_id AND ul.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert recipe ingredients"
  ON public.inventory_recipe_ingredients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventory_items i
      JOIN public.user_locations ul ON ul.location_id = i.location_id
      WHERE i.id = recipe_item_id AND ul.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can update recipe ingredients"
  ON public.inventory_recipe_ingredients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_items i
      JOIN public.user_locations ul ON ul.location_id = i.location_id
      WHERE i.id = recipe_item_id AND ul.user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can delete recipe ingredients"
  ON public.inventory_recipe_ingredients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_items i
      JOIN public.user_locations ul ON ul.location_id = i.location_id
      WHERE i.id = recipe_item_id AND ul.user_id = auth.uid()
    )
  );