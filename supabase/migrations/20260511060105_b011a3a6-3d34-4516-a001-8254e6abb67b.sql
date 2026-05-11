
ALTER TABLE public.brand_inventory_templates
  ADD COLUMN IF NOT EXISTS auto_deploy_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.brand_auto_deployment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_template_id uuid NOT NULL REFERENCES public.brand_inventory_templates(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  recipe_ids uuid[] NOT NULL DEFAULT '{}',
  action text NOT NULL DEFAULT 'created', -- 'created' | 'reactivated'
  triggered_by text NOT NULL DEFAULT 'nightly_sweep',
  deployed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_auto_deployment_log_location_date
  ON public.brand_auto_deployment_log (location_id, deployed_at DESC);

CREATE INDEX IF NOT EXISTS idx_brand_auto_deployment_log_template
  ON public.brand_auto_deployment_log (brand_template_id);

ALTER TABLE public.brand_auto_deployment_log ENABLE ROW LEVEL SECURITY;

-- Brand members of the location's brand can view; service role bypasses RLS for inserts.
CREATE POLICY "Brand members can view auto-deployment log"
  ON public.brand_auto_deployment_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.locations l
      JOIN public.organizations o ON o.id = l.organization_id
      JOIN public.brand_members bm ON bm.brand_id = o.brand_id
      WHERE l.id = brand_auto_deployment_log.location_id
        AND bm.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );
