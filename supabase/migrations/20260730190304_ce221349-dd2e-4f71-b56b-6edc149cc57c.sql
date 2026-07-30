-- 1. job_applications: anon must only be able to INSERT (submit), never read/edit.
REVOKE SELECT, UPDATE, DELETE ON public.job_applications FROM anon;
GRANT INSERT ON public.job_applications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_applications TO authenticated;
GRANT ALL ON public.job_applications TO service_role;

-- 2. kds_orders: archived feature; backend-only.
DROP POLICY IF EXISTS "Authenticated users can view kds_orders" ON public.kds_orders;
DROP POLICY IF EXISTS "Authenticated users can insert kds_orders" ON public.kds_orders;
DROP POLICY IF EXISTS "Authenticated users can update kds_orders" ON public.kds_orders;
REVOKE ALL ON public.kds_orders FROM anon;
REVOKE ALL ON public.kds_orders FROM authenticated;
GRANT ALL ON public.kds_orders TO service_role;

-- 3. ovation_integrations: credentials -> brand admins/owners + super admins only.
DROP POLICY IF EXISTS "Brand admins can view ovation integrations" ON public.ovation_integrations;
CREATE POLICY "Brand admins can view ovation integrations"
ON public.ovation_integrations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = ovation_integrations.brand_id
      AND bm.user_id = auth.uid()
      AND bm.brand_role = ANY (ARRAY['admin'::text, 'owner'::text])
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'::text
  )
);
REVOKE ALL ON public.ovation_integrations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ovation_integrations TO authenticated;
GRANT ALL ON public.ovation_integrations TO service_role;

-- 4. profiles: drop dead anon PIN-lookup policy (anon SELECT grant already revoked;
--    the punch clock uses the punch_clock_lookup_pin RPC).
DROP POLICY IF EXISTS "Anon can lookup profiles by PIN for punch clock" ON public.profiles;

-- 5. sales_aggregates: authenticated + location-scoped only.
DROP POLICY IF EXISTS "Users can view sales aggregates for their locations" ON public.sales_aggregates;
CREATE POLICY "Users can view sales aggregates for their locations"
ON public.sales_aggregates
FOR SELECT
TO authenticated
USING (public.has_location_access(auth.uid(), location_id));
REVOKE ALL ON public.sales_aggregates FROM anon;
GRANT SELECT ON public.sales_aggregates TO authenticated;
GRANT ALL ON public.sales_aggregates TO service_role;