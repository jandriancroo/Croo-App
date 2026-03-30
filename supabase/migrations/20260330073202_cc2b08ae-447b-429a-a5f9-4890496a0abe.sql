
-- Add brand_id to recipe_blueprints (nullable FK to brands)
ALTER TABLE public.recipe_blueprints 
  ADD COLUMN brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE;

-- Make location_id nullable (brand recipes won't have a location)
ALTER TABLE public.recipe_blueprints 
  ALTER COLUMN location_id DROP NOT NULL;

-- Add constraint: must have either brand_id or location_id
ALTER TABLE public.recipe_blueprints 
  ADD CONSTRAINT recipe_blueprints_owner_check 
  CHECK (brand_id IS NOT NULL OR location_id IS NOT NULL);

-- Index for brand-level queries
CREATE INDEX idx_recipe_blueprints_brand_id ON public.recipe_blueprints(brand_id) WHERE brand_id IS NOT NULL;

-- Also add brand_id to recipe_blueprint_ingredients for brand-level ingredient rows
-- (ingredients reference their parent blueprint, so this isn't strictly needed,
--  but let's ensure RLS can scope properly)

-- RLS: allow brand admins to manage brand recipes
CREATE POLICY "Brand admins can manage brand recipes"
  ON public.recipe_blueprints
  FOR ALL
  TO authenticated
  USING (
    brand_id IS NOT NULL AND public.is_brand_admin(auth.uid(), brand_id)
  )
  WITH CHECK (
    brand_id IS NOT NULL AND public.is_brand_admin(auth.uid(), brand_id)
  );

-- RLS: allow location users to READ brand recipes for their brand
CREATE POLICY "Location users can read brand recipes"
  ON public.recipe_blueprints
  FOR SELECT
  TO authenticated
  USING (
    brand_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.locations l
      JOIN public.organizations o ON o.id = l.organization_id
      JOIN public.user_locations ul ON ul.location_id = l.id
      WHERE o.brand_id = recipe_blueprints.brand_id
        AND ul.user_id = auth.uid()
    )
  );
