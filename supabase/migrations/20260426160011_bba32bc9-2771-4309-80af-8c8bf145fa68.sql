CREATE OR REPLACE FUNCTION public.cleanup_supabase_internal_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  http_deleted INTEGER;
  cron_deleted INTEGER;
BEGIN
  DELETE FROM net._http_response WHERE created < (now() - INTERVAL '7 days');
  GET DIAGNOSTICS http_deleted = ROW_COUNT;

  DELETE FROM cron.job_run_details WHERE start_time < (now() - INTERVAL '30 days');
  GET DIAGNOSTICS cron_deleted = ROW_COUNT;

  RAISE NOTICE 'Weekly log cleanup: % http_response rows, % job_run_details rows',
    http_deleted, cron_deleted;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-supabase-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-supabase-logs',
  '0 12 * * 0',
  $$ SELECT public.cleanup_supabase_internal_logs(); $$
);