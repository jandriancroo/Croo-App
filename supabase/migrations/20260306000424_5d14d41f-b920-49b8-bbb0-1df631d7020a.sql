SELECT cron.schedule(
  'sync-kds-hourly',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/fresh-kds-service',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg"}'::jsonb,
    body := '{"action": "sync-all-kds-locations"}'::jsonb
  ) AS request_id;
  $$
);