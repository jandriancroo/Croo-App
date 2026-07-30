DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN
    SELECT * FROM (VALUES
      ('alert-push-sender', 'alert-push-sender', '* * * * *'),
      ('email-queue-sender-every-minute', 'email-queue-sender', '* * * * *'),
      ('email-batch-sender-every-5min', 'email-batch-sender', '*/5 * * * *'),
      ('process-maintenance-queue', 'maintenance-queue-processor', '* * * * *')
    ) AS t(jobname, fn, sched)
  LOOP
    PERFORM cron.unschedule(j.jobname) WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j.jobname);
    PERFORM cron.schedule(
      j.jobname,
      j.sched,
      format($fmt$
        SELECT net.http_post(
          url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/%s',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
          ),
          body := '{}'::jsonb
        ) AS request_id;
      $fmt$, j.fn)
    );
  END LOOP;
END $$;