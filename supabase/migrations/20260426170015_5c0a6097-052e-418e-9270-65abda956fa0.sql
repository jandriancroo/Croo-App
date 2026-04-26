-- ============================================================
-- Reclaim disk space and stop cron log re-bloat
-- (VACUUM FULL is run separately — cannot live in a transaction)
-- ============================================================

-- 1) Slow the chatty email queue poller from every 5s to every 30s.
SELECT cron.unschedule('process-email-queue');

SELECT cron.schedule(
  'process-email-queue',
  '30 seconds',
  $$
  SELECT CASE
    WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
      THEN NULL
    WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
      THEN net.http_post(
        url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/process-email-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key'
          )
        ),
        body := '{}'::jsonb
      )
    ELSE NULL
  END;
  $$
);

-- 2) Truncate the bloated cron log table (TRUNCATE reclaims disk immediately).
TRUNCATE TABLE cron.job_run_details;

-- 3) Clear out dead rows from the HTTP response log (VACUUM FULL happens after migration).
DELETE FROM net._http_response;

-- 4) Daily, more aggressive cleanup function (was weekly, kept 7 days).
CREATE OR REPLACE FUNCTION public.cleanup_internal_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  DELETE FROM cron.job_run_details
  WHERE start_time < now() - interval '24 hours';

  DELETE FROM net._http_response
  WHERE created < now() - interval '24 hours';
END;
$$;

-- 5) Schedule daily (was weekly). Unschedule by name (safe if absent).
DO $$
DECLARE
  jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-internal-logs'
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'cleanup-internal-logs',
  '0 9 * * *',  -- 09:00 UTC daily (≈ 2 AM PST)
  $$SELECT public.cleanup_internal_logs();$$
);