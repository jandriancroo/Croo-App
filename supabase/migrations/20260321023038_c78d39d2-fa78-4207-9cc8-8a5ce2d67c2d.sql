-- Fix the sales sync cron: currently calling dead 'sync-live-sales' (404), update to call 'sales-service' every 1 minute
SELECT cron.unschedule('sync-live-sales-every-7-min');

SELECT cron.schedule(
  'sync-sales-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/sales-service',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);