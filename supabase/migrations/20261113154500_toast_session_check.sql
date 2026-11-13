-- Email Jordan if Hayward's 5:00 AM PT (7:00 AM CT) session-only Toast probe
-- failed or the mini did not report by 5:15 AM PT. pg_cron is UTC, so the job
-- wakes every 5 minutes and this DST-safe guard (America/Los_Angeles) decides
-- whether to call the edge function. The function also no-ops outside the
-- window and dedupes to one email per PT day. Success sends nothing.
-- Does not change the runner's 9 AM–11 PM CT poll window.

CREATE OR REPLACE FUNCTION public._toast_session_check_due(_now timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT extract(hour FROM (_now AT TIME ZONE 'America/Los_Angeles')) = 5
     AND extract(minute FROM (_now AT TIME ZONE 'America/Los_Angeles')) >= 15;
$$;

REVOKE EXECUTE ON FUNCTION public._toast_session_check_due(timestamptz) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'toast-session-check' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'toast-session-check',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/toast-session-check',
    headers := public.cron_edge_headers(),
    body := '{"action":"check"}'::jsonb,
    timeout_milliseconds := 15000
  )
  WHERE public._toast_session_check_due();
  $job$
);
