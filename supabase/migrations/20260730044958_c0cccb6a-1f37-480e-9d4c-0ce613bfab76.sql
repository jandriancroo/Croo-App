-- 1. Backup tables: enable RLS (no policies = only service_role/superuser access)
ALTER TABLE public.inventory_count_items_backup_20260420 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items_produce_backup_20260421 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inventory_count_items_backup_20260420 FROM anon, authenticated;
REVOKE ALL ON public.inventory_items_produce_backup_20260421 FROM anon, authenticated;
GRANT ALL ON public.inventory_count_items_backup_20260420 TO service_role;
GRANT ALL ON public.inventory_items_produce_backup_20260421 TO service_role;

-- 2. Ovation location mappings: credentials must not be readable by all location staff
DROP POLICY IF EXISTS "Users can view ovation location mappings" ON public.ovation_location_mappings;
-- Admin-only ALL policy already exists ("Admins can manage ovation location mappings")

-- 3. KDS orders: scope the service policy to service_role instead of public
DROP POLICY IF EXISTS "Service role full access" ON public.kds_orders;
CREATE POLICY "Service role full access"
ON public.kds_orders
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);