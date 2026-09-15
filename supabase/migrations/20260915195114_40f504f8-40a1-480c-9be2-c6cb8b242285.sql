CREATE TABLE public.recipe_integrity_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  recipe_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  recipe_name TEXT NOT NULL,
  ingredient_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  ingredient_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recipe_integrity_alerts_unique UNIQUE (location_id, recipe_item_id, ingredient_item_id)
);

CREATE INDEX idx_recipe_integrity_alerts_location_status
  ON public.recipe_integrity_alerts (location_id, status);
CREATE INDEX idx_recipe_integrity_alerts_brand_status
  ON public.recipe_integrity_alerts (brand_id, status);

GRANT SELECT ON public.recipe_integrity_alerts TO authenticated;
GRANT ALL ON public.recipe_integrity_alerts TO service_role;

ALTER TABLE public.recipe_integrity_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view recipe integrity alerts for their locations"
ON public.recipe_integrity_alerts
FOR SELECT
TO authenticated
USING (
  public.has_role_or_higher(auth.uid(), 'manager')
  AND (
    public.has_role_or_higher(auth.uid(), 'super_admin')
    OR location_id IN (SELECT public.get_user_location_ids(auth.uid()))
  )
);

CREATE TRIGGER update_recipe_integrity_alerts_updated_at
BEFORE UPDATE ON public.recipe_integrity_alerts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();