
-- Helper: builds standard auth headers for scheduled jobs using the vault service key
CREATE OR REPLACE FUNCTION public.cron_edge_headers()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
  )
$$;

REVOKE ALL ON FUNCTION public.cron_edge_headers() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('sync-sales-every-minute', '* * * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/sales-service',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('clover-sync-every-2-min', '*/2 * * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/clover-sync',
    headers := public.cron_edge_headers(),
    body := '{"action":"sync_all_today"}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('clover-sync-yesterday-3am-pst', '0 11 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/clover-sync',
    headers := public.cron_edge_headers(),
    body := '{"action":"sync_all_yesterday"}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('aloha-sync-every-2-min', '*/2 * * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/aloha-sync',
    headers := public.cron_edge_headers(),
    body := '{"action":"sync_all_today"}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('aloha-sync-yesterday-3am-pst', '0 11 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/aloha-sync',
    headers := public.cron_edge_headers(),
    body := '{"action":"sync_all_yesterday"}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('nightly-labor-maintenance', '1 11 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/labor-service',
    headers := public.cron_edge_headers(),
    body := '{"action": "refresh-stale"}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('generate-daily-briefing-6am', '0 14 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/generate-daily-briefing',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('send-daily-changelog', '59 7 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/send-daily-changelog',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('nightly-vendor-gap-scan', '15 10 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/vendor-gap-scan',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('vendor-gap-scan-nightly', '0 12 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/vendor-gap-scan',
    headers := public.cron_edge_headers(),
    body := '{"trigger":"cron"}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('pa-nightly-invoice-sync', '30 11 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/produce-alliance-service',
    headers := public.cron_edge_headers(),
    body := '{"action":"nightly_invoice_sync"}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('shift-reminder-dispatch-every-minute', '* * * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/shift-reminder-dispatch',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  ) AS request_id;
$job$);

SELECT cron.schedule('nightly-pack-config-seeder', '15 4 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/pack-config-seeder?dry_run=false',
    headers := public.cron_edge_headers(),
    body := jsonb_build_object('trigger','cron','at', now())
  ) AS request_id;
$job$);

SELECT cron.schedule('pfg-scheduled-price-sync-every-8h', '0 */8 * * *', $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/pfg-scheduled-price-sync',
    headers := public.cron_edge_headers(),
    body := jsonb_build_object('triggered_at', now())
  ) AS request_id;
$job$);
