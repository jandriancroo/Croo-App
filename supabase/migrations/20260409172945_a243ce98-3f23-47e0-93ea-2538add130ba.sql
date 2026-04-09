DROP POLICY IF EXISTS "Brand admins can manage ovation integrations" ON public.ovation_integrations;

CREATE POLICY "Brand admins can manage ovation integrations"
ON public.ovation_integrations
FOR ALL
TO authenticated
USING (
  (EXISTS (SELECT 1 FROM brand_members bm WHERE bm.brand_id = ovation_integrations.brand_id AND bm.user_id = auth.uid() AND bm.brand_role = ANY (ARRAY['admin','owner'])))
  OR (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin'))
)
WITH CHECK (
  (EXISTS (SELECT 1 FROM brand_members bm WHERE bm.brand_id = ovation_integrations.brand_id AND bm.user_id = auth.uid() AND bm.brand_role = ANY (ARRAY['admin','owner'])))
  OR (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin'))
);