select net.http_post(
  url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/labor-service?action=backfill',
  headers := public.cron_edge_headers(),
  body := '{"locationId":"79456db0-c817-464e-a849-bca44f8d6f34","startDate":"2026-07-19","endDate":"2026-08-01","forceRefresh":true}'::jsonb
) as request_id;