DO $mig$
DECLARE
  d text;
  before_len int;
BEGIN
  d := pg_get_functiondef('public.check_alerts_sql()'::regprocedure);

  -- 1) Dynamic weekly templates are frequency='weekly' AND template_type='dynamic'.
  before_len := length(d);
  d := replace(d,
    'AND c.frequency IN (''daily'', ''dynamic'')',
    'AND (c.frequency = ''daily'' OR c.template_type = ''dynamic'')');
  IF length(d) = before_len THEN RAISE EXCEPTION 'patch 1 (overdue selector) not applied'; END IF;

  -- 2) days_of_week is Mon=0..Sun=6; local_day is Postgres DOW (Sun=0) — full rotation off.
  before_len := length(d);
  d := replace(d,
    'OR (days_of_week IS NOT NULL AND local_day = ANY(days_of_week))',
    'OR (days_of_week IS NOT NULL AND business_local_day_mon0 = ANY(days_of_week))');
  IF length(d) = before_len THEN RAISE EXCEPTION 'patch 2 (day-of-week) not applied'; END IF;

  -- 3) Alerts ignore archived items on the COMPLETED side too (both overdue + monthly loops).
  before_len := length(d);
  d := replace(d,
    'JOIN checklist_responses cr ON cr.submission_id = cs.id',
    'JOIN checklist_responses cr ON cr.submission_id = cs.id
            JOIN checklist_items ci_live ON ci_live.id = cr.item_id AND ci_live.deleted_at IS NULL');
  IF length(d) = before_len THEN RAISE EXCEPTION 'patch 3 (archived responses) not applied'; END IF;

  -- 4) Clamp remaining at 0.
  before_len := length(d);
  d := replace(d,
    'remaining_tasks := total_items - COALESCE(completed_items, 0);',
    'remaining_tasks := GREATEST(0, total_items - COALESCE(completed_items, 0));');
  IF length(d) = before_len THEN RAISE EXCEPTION 'patch 4a (clamp overdue) not applied'; END IF;

  before_len := length(d);
  d := replace(d,
    'mc_remaining := mc_total_items - COALESCE(mc_completed, 0);',
    'mc_remaining := GREATEST(0, mc_total_items - COALESCE(mc_completed, 0));');
  IF length(d) = before_len THEN RAISE EXCEPTION 'patch 4b (clamp monthly) not applied'; END IF;

  EXECUTE d;
END $mig$;