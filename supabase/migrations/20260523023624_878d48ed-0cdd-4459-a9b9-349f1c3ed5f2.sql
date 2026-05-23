
ALTER TABLE public.pack_config_seed_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members can view seed logs"
  ON public.pack_config_seed_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates t
      JOIN public.organizations o ON o.brand_id = t.brand_id
      JOIN public.locations l ON l.organization_id = o.id
      WHERE t.id = pack_config_seed_log.brand_template_id
        AND public.has_location_access(auth.uid(), l.id)
    )
  );

-- No INSERT/UPDATE/DELETE policies: edge function writes via service_role bypass
