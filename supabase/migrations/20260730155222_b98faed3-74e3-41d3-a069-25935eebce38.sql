-- 1. Re-point auto-punch-out cron jobs at the service-role key (function is now guarded).
SELECT cron.unschedule('auto-punch-out-early');
SELECT cron.unschedule('auto-punch-out-late');

SELECT cron.schedule(
  'auto-punch-out-early',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/auto-punch-out',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now(), 'source', 'cron-early')
  );
  $$
);

SELECT cron.schedule(
  'auto-punch-out-late',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/auto-punch-out',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object('triggered_at', now(), 'source', 'cron-late')
  );
  $$
);

-- 2. organization_positions: replace always-true write policies with admin-scoped ones.
DROP POLICY IF EXISTS "Admins can delete org positions" ON public.organization_positions;
DROP POLICY IF EXISTS "Admins can insert org positions" ON public.organization_positions;
DROP POLICY IF EXISTS "Admins can update org positions" ON public.organization_positions;

CREATE POLICY "Admins can manage org positions"
ON public.organization_positions
FOR ALL
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.is_org_admin(auth.uid(), organization_id)
  OR public.has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR public.is_org_admin(auth.uid(), organization_id)
  OR public.has_role(auth.uid(), 'admin'::app_role)
);