-- Menu price overrides: local operator pricing that doesn't affect brand data or AvT
CREATE TABLE public.menu_price_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  blueprint_id UUID NOT NULL REFERENCES public.recipe_blueprints(id) ON DELETE CASCADE,
  menu_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, blueprint_id)
);

ALTER TABLE public.menu_price_overrides ENABLE ROW LEVEL SECURITY;

-- Read: authenticated users who are members of the location's organization
CREATE POLICY "Users can view menu prices at their locations"
ON public.menu_price_overrides
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.locations l
    JOIN public.organization_members om ON om.organization_id = l.organization_id
    WHERE l.id = menu_price_overrides.location_id
    AND om.user_id = auth.uid()
  )
);

-- Insert
CREATE POLICY "Users can create menu prices at their locations"
ON public.menu_price_overrides
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.locations l
    JOIN public.organization_members om ON om.organization_id = l.organization_id
    WHERE l.id = menu_price_overrides.location_id
    AND om.user_id = auth.uid()
  )
);

-- Update
CREATE POLICY "Users can update menu prices at their locations"
ON public.menu_price_overrides
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.locations l
    JOIN public.organization_members om ON om.organization_id = l.organization_id
    WHERE l.id = menu_price_overrides.location_id
    AND om.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.locations l
    JOIN public.organization_members om ON om.organization_id = l.organization_id
    WHERE l.id = menu_price_overrides.location_id
    AND om.user_id = auth.uid()
  )
);

-- Delete
CREATE POLICY "Users can delete menu prices at their locations"
ON public.menu_price_overrides
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.locations l
    JOIN public.organization_members om ON om.organization_id = l.organization_id
    WHERE l.id = menu_price_overrides.location_id
    AND om.user_id = auth.uid()
  )
);

-- Auto-update timestamp
CREATE TRIGGER update_menu_price_overrides_updated_at
BEFORE UPDATE ON public.menu_price_overrides
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();