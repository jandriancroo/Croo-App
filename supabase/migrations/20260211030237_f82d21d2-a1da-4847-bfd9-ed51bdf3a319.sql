
-- Fix check-alerts cron job to call the correct edge function URL
SELECT cron.unschedule(9);

SELECT cron.schedule(
  'check-alerts-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/alert-service?action=check-alerts',
    headers := '{"Content-Type": "application/json", "x-supabase-internal": "true"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
