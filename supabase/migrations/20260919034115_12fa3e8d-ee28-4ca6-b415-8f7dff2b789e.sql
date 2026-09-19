SELECT cron.schedule(
  'seed-week-projections-all-pos',
  '20 11 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/sales-week-projections',
    headers := public.cron_edge_headers(),
    body := '{"action":"seed_all_weeks"}'::jsonb
  );
  $job$
);

SELECT cron.schedule(
  'seed-next-week-projections-all-pos',
  '25 11 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/sales-week-projections',
    headers := public.cron_edge_headers(),
    body := '{"action":"seed_all_weeks","weekOffset":1}'::jsonb
  );
  $job$
);