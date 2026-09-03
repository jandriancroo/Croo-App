select cron.unschedule('nightly-universal-update') where exists (select 1 from cron.job where jobname = 'nightly-universal-update');

select cron.schedule(
  'nightly-universal-update',
  '30 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/universal-update-broadcast',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);