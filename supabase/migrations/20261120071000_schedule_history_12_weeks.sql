-- Schedule history retention: 12 weeks (84 days), whole weeks, one constant, no separate exception (Jordan, Nov 19 2026).
-- Replaces purge_completed_week_change_log from 0103 / 20261119230000. Helpers unchanged (_keep is a parameter).
-- Note: the employee profile "original shifts" stats (original_shift_changes, 90-day lookback) now see ~12 weeks (84 of its 90 days).
-- Rollback: re-run the purge_completed_week_change_log definition from 0103.
CREATE OR REPLACE FUNCTION public.purge_completed_week_change_log()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c_keep constant interval := interval '84 days'; -- 12 whole weeks after the week's last shift ends
  v_n int;
BEGIN
  WITH done AS (
    SELECT s.id
      FROM public.schedules s
     WHERE s.week_start_date <= (now() - c_keep)::date
       AND EXISTS (SELECT 1 FROM public.schedule_change_log l WHERE l.schedule_id = s.id)
       AND public._schedule_week_completed(s.id, c_keep)
  ), del AS (
    DELETE FROM public.schedule_change_log l USING done d
     WHERE l.schedule_id = d.id
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM del;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.purge_completed_week_change_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_completed_week_change_log() TO service_role;
