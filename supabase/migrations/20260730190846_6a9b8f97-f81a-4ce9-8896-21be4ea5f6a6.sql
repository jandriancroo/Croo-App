-- 1. brand_inventory_staging: brand/org admins only (was ALL true to authenticated).
DROP POLICY IF EXISTS "Authenticated users can manage staging" ON public.brand_inventory_staging;

CREATE POLICY "Brand admins can manage staging"
ON public.brand_inventory_staging
FOR ALL
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = brand_inventory_staging.brand_id
      AND bm.user_id = auth.uid()
      AND bm.brand_role = ANY (ARRAY['admin'::text, 'owner'::text])
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = brand_inventory_staging.brand_id
      AND bm.user_id = auth.uid()
      AND bm.brand_role = ANY (ARRAY['admin'::text, 'owner'::text])
  )
);

REVOKE ALL ON public.brand_inventory_staging FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_inventory_staging TO authenticated;
GRANT ALL ON public.brand_inventory_staging TO service_role;

-- 2. inventory_count_audit_log: writer must have access to the count's location.
DROP POLICY IF EXISTS "Authenticated users can insert audit log" ON public.inventory_count_audit_log;

CREATE POLICY "Users with location access can insert audit log"
ON public.inventory_count_audit_log
FOR INSERT
TO authenticated
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND (
    count_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.inventory_counts ic
      WHERE ic.id::text = inventory_count_audit_log.count_id
        AND public.has_location_access(auth.uid(), ic.location_id)
    )
  )
);

DROP POLICY IF EXISTS "Super admins can read audit log" ON public.inventory_count_audit_log;

CREATE POLICY "Managers can read audit log for their locations"
ON public.inventory_count_audit_log
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.inventory_counts ic
    WHERE ic.id::text = inventory_count_audit_log.count_id
      AND public.has_location_access(auth.uid(), ic.location_id)
      AND public.has_role_or_higher(auth.uid(), 'manager')
  )
);

REVOKE ALL ON public.inventory_count_audit_log FROM anon;
GRANT SELECT, INSERT ON public.inventory_count_audit_log TO authenticated;
GRANT ALL ON public.inventory_count_audit_log TO service_role;

-- 3. kds_cache: location-scoped reads only.
DROP POLICY IF EXISTS "Authenticated users can read kds_cache" ON public.kds_cache;

CREATE POLICY "Users can read kds_cache for their locations"
ON public.kds_cache
FOR SELECT
TO authenticated
USING (public.has_location_access(auth.uid(), location_id));

REVOKE ALL ON public.kds_cache FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.kds_cache FROM authenticated;
GRANT SELECT ON public.kds_cache TO authenticated;
GRANT ALL ON public.kds_cache TO service_role;

-- 4. Mislabeled "Service role" policies that were actually open to everyone.
DROP POLICY IF EXISTS "Service role can insert briefings" ON public.croo_ai_briefings;
CREATE POLICY "Service role can insert briefings"
ON public.croo_ai_briefings FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert summary logs" ON public.daily_summary_logs;
CREATE POLICY "Service role can insert summary logs"
ON public.daily_summary_logs FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "System can create transactions" ON public.croo_cash_transactions;
CREATE POLICY "Service role can create transactions"
ON public.croo_cash_transactions FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage opus resources" ON public.opus_resource_index;
CREATE POLICY "Service role can manage opus resources"
ON public.opus_resource_index FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON public.croo_ai_briefings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.daily_summary_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.croo_cash_transactions FROM anon, authenticated;
REVOKE ALL ON public.opus_resource_index FROM anon, authenticated;