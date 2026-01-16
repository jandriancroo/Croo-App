-- Schedule the daily summaries check to run every hour
SELECT cron.schedule(
  'scheduled-daily-summaries',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/scheduled-daily-summaries',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);