-- 1. Revoke anon/public EXECUTE on the routines added tonight.
REVOKE ALL ON FUNCTION public.match_vendor_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_vendor_name(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.normalize_vendor_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_vendor_name(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reconcile_brand_deploy_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_brand_deploy_log() TO service_role;

-- 2. vendor_registry had read-only policies, so "create a new vendor" from the
--    confirmation card would have failed. Managers may add and edit vendors.
GRANT INSERT, UPDATE ON public.vendor_registry TO authenticated;

DROP POLICY IF EXISTS "Managers can add vendors" ON public.vendor_registry;
CREATE POLICY "Managers can add vendors"
  ON public.vendor_registry FOR INSERT TO authenticated
  WITH CHECK (has_role_or_higher(auth.uid(), 'manager'));

DROP POLICY IF EXISTS "Managers can edit vendors" ON public.vendor_registry;
CREATE POLICY "Managers can edit vendors"
  ON public.vendor_registry FOR UPDATE TO authenticated
  USING (has_role_or_higher(auth.uid(), 'manager'))
  WITH CHECK (has_role_or_higher(auth.uid(), 'manager'));