-- Master inventory templates at brand level
-- Stores weight-based pan conversions that adapt to any pack size
CREATE TABLE public.brand_inventory_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  common_name TEXT,
  -- Weight-based pan conversion
  pan_baseline_key TEXT NOT NULL DEFAULT 'third_pan',
  pan_units_per_lb NUMERIC,
  pan_enabled_keys TEXT[] NOT NULL DEFAULT ARRAY['third_pan', 'sixth_pan'],
  -- For non-weight items (count-based), store units directly
  is_weight_based BOOLEAN NOT NULL DEFAULT true,
  pan_units_per_unit NUMERIC,
  -- Matching
  match_keywords TEXT[] NOT NULL DEFAULT '{}',
  -- Optional defaults
  category TEXT,
  -- Metadata
  source_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  source_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(brand_id, product_name)
);

-- Track which items have been deployed from templates
CREATE TABLE public.brand_inventory_deployments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.brand_inventory_templates(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  weight_per_unit NUMERIC,
  calculated_baseline NUMERIC,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  review_reason TEXT,
  deployed_by UUID REFERENCES public.profiles(id),
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(template_id, location_id)
);

-- RLS
ALTER TABLE public.brand_inventory_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_inventory_deployments ENABLE ROW LEVEL SECURITY;

-- Templates: brand admins + users with location access in the brand's org
CREATE POLICY "Brand members can view templates"
  ON public.brand_inventory_templates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.organizations o
      JOIN public.locations l ON l.organization_id = o.id
      WHERE o.brand_id = brand_inventory_templates.brand_id
        AND has_location_access(auth.uid(), l.id)
    )
  );

CREATE POLICY "Brand admins and managers can manage templates"
  ON public.brand_inventory_templates FOR ALL
  USING (
    is_brand_admin(auth.uid(), brand_id)
    OR has_role_or_higher(auth.uid(), 'manager')
  );

CREATE POLICY "Users with location access can view deployments"
  ON public.brand_inventory_deployments FOR SELECT
  USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Managers can manage deployments"
  ON public.brand_inventory_deployments FOR ALL
  USING (
    has_location_access(auth.uid(), location_id)
    AND has_role_or_higher(auth.uid(), 'manager')
  );

-- Timestamps
CREATE TRIGGER update_brand_inventory_templates_updated_at
  BEFORE UPDATE ON public.brand_inventory_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();