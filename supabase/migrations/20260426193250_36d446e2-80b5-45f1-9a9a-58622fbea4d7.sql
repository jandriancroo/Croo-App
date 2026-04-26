-- Remove the now-redundant weekly log cleanup job.
-- The daily cleanup-internal-logs job (added 17:00) cleans the same two tables
-- (net._http_response + cron.job_run_details) every 24 hours, making the weekly
-- version obsolete.

DO $$
DECLARE
  jid bigint;
BEGIN
  FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-supabase-logs'
  LOOP
    PERFORM cron.unschedule(jid);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.cleanup_supabase_internal_logs();