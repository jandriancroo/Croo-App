-- Replace fixed-Pacific goal seeders with one store-local 3 AM engine tick.
DO $$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job
    WHERE jobname IN ('seed-week-projections-all-pos', 'seed-next-week-projections-all-pos', 'goal-engine-tick')
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'goal-engine-tick',
  '30 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/goal-engine',
    headers := public.cron_edge_headers(),
    body := '{"action":"tick"}'::jsonb
  );
  $job$
);
