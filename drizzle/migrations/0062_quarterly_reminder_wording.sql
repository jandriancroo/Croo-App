DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.check_alerts_sql()'::regprocedure);
  IF position('remaining this quarter' in d) > 0 THEN RETURN; END IF;
  d := replace(d,
    'SELECT c.id, c.title, c.visible_days_before_month_end,',
    'SELECT c.id, c.title, c.visible_days_before_month_end, public.checklist_period_kind(c) AS p_kind,');
  d := replace(d,
    $r$' remaining for ' || to_char(now() AT TIME ZONE tz, 'Month'),$r$,
    $r$CASE WHEN mcl.p_kind = 'quarter' THEN ' remaining this quarter' ELSE ' remaining for ' || to_char(now() AT TIME ZONE tz, 'Month') END,$r$);
  IF position('remaining this quarter' in d) = 0 OR position('AS p_kind' in d) = 0 THEN
    RAISE EXCEPTION 'check_alerts_sql text did not match; nothing changed';
  END IF;
  EXECUTE d;
END
$mig$;