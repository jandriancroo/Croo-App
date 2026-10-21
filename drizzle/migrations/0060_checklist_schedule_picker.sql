ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS schedule_repeats boolean,
  ADD COLUMN IF NOT EXISTS schedule_period text,
  ADD COLUMN IF NOT EXISTS schedule_mode text,
  ADD COLUMN IF NOT EXISTS schedule_weekdays integer[],
  ADD COLUMN IF NOT EXISTS schedule_day integer,
  ADD COLUMN IF NOT EXISTS schedule_quarter_month integer,
  ADD COLUMN IF NOT EXISTS schedule_last_n integer;

ALTER TABLE public.checklists DROP CONSTRAINT IF EXISTS checklists_frequency_check;
ALTER TABLE public.checklists ADD CONSTRAINT checklists_frequency_check
  CHECK (frequency = ANY (ARRAY['daily','weekly','monthly','quarterly','single_day']));

UPDATE public.checklists SET schedule_repeats = true, schedule_period = 'week', schedule_mode = 'days',
  schedule_weekdays = ARRAY[0,1,2,3,4,5,6]
WHERE COALESCE(template_type, 'standard') = 'standard' AND frequency IN ('daily', 'weekly') AND schedule_mode IS NULL;
UPDATE public.checklists SET schedule_repeats = true, schedule_period = 'month', schedule_mode = 'last_n',
  schedule_last_n = visible_days_before_month_end
WHERE COALESCE(template_type, 'standard') = 'standard' AND frequency = 'monthly' AND schedule_mode IS NULL
  AND COALESCE(visible_days_before_month_end, 0) > 0;
UPDATE public.checklists SET schedule_repeats = false
WHERE COALESCE(template_type, 'standard') = 'standard' AND frequency = 'single_day' AND schedule_mode IS NULL;

ALTER TABLE public.checklists
  ADD CONSTRAINT checklists_schedule_period_check CHECK (schedule_period IS NULL OR schedule_period IN ('week','month','quarter')),
  ADD CONSTRAINT checklists_schedule_mode_check CHECK (schedule_mode IS NULL OR schedule_mode IN ('days','on_day','last_n')),
  ADD CONSTRAINT checklists_schedule_day_check CHECK (schedule_day IS NULL OR schedule_day = -1 OR schedule_day BETWEEN 1 AND 31),
  ADD CONSTRAINT checklists_schedule_quarter_month_check CHECK (schedule_quarter_month IS NULL OR schedule_quarter_month BETWEEN 1 AND 3),
  ADD CONSTRAINT checklists_schedule_last_n_check CHECK (schedule_last_n IS NULL OR schedule_last_n BETWEEN 1 AND 92),
  ADD CONSTRAINT checklists_schedule_weekdays_check CHECK (schedule_weekdays IS NULL OR schedule_weekdays <@ ARRAY[0,1,2,3,4,5,6]);

CREATE OR REPLACE FUNCTION public.checklist_period_kind(c public.checklists)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN c.template_type = 'dynamic' THEN 'dynamic'
    WHEN c.template_type = 'training' OR c.frequency = 'training' THEN 'none'
    WHEN c.schedule_mode IS NULL AND c.schedule_repeats IS DISTINCT FROM false
      THEN CASE WHEN c.frequency = 'monthly' THEN 'month' ELSE 'day' END
    WHEN c.schedule_repeats IS DISTINCT FROM false AND c.schedule_mode = 'last_n'
      AND c.schedule_period IN ('week','month','quarter') THEN c.schedule_period
    ELSE 'day' END
$$;

CREATE OR REPLACE FUNCTION public.checklist_period_start(c public.checklists, d date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE public.checklist_period_kind(c)
    WHEN 'week' THEN d - (EXTRACT(ISODOW FROM d)::int - 1)
    WHEN 'month' THEN date_trunc('month', d)::date
    WHEN 'quarter' THEN date_trunc('quarter', d)::date
    ELSE d END
$$;

CREATE OR REPLACE FUNCTION public.checklist_period_end(c public.checklists, d date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE public.checklist_period_kind(c)
    WHEN 'week' THEN d - (EXTRACT(ISODOW FROM d)::int - 1) + 6
    WHEN 'month' THEN (date_trunc('month', d) + interval '1 month - 1 day')::date
    WHEN 'quarter' THEN (date_trunc('quarter', d) + interval '3 months - 1 day')::date
    ELSE d END
$$;

CREATE OR REPLACE FUNCTION public.checklist_shows_on(c public.checklists, d date)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  dow int := EXTRACT(ISODOW FROM d)::int - 1;
  dim int := EXTRACT(DAY FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int;
  dd int := EXTRACT(DAY FROM d)::int;
  n int := GREATEST(1, COALESCE(c.schedule_last_n, 1));
  qs date := date_trunc('quarter', d)::date;
  target int;
BEGIN
  IF c.template_type = 'dynamic' THEN RETURN true; END IF;
  IF c.template_type = 'training' OR c.frequency = 'training' THEN RETURN false; END IF;
  IF c.schedule_mode IS NULL AND c.schedule_repeats IS DISTINCT FROM false THEN
    IF c.frequency = 'single_day' THEN RETURN c.scheduled_date IS NULL OR c.scheduled_date = d; END IF;
    IF c.frequency = 'monthly' AND COALESCE(c.visible_days_before_month_end, 0) > 0 THEN
      RETURN dim - dd < c.visible_days_before_month_end;
    END IF;
    RETURN true;
  END IF;
  IF c.schedule_repeats = false THEN RETURN c.scheduled_date IS NOT NULL AND c.scheduled_date = d; END IF;
  target := CASE WHEN c.schedule_day IS NULL OR c.schedule_day < 1 THEN dim ELSE LEAST(c.schedule_day, dim) END;
  IF c.schedule_period = 'week' THEN
    IF c.schedule_mode = 'last_n' THEN RETURN dow >= 7 - n; END IF;
    RETURN dow = ANY (COALESCE(c.schedule_weekdays, '{}'::int[]));
  ELSIF c.schedule_period = 'month' THEN
    IF c.schedule_mode = 'last_n' THEN RETURN dd > dim - n; END IF;
    RETURN dd = target;
  ELSIF c.schedule_period = 'quarter' THEN
    IF c.schedule_mode = 'last_n' THEN
      RETURN d > (qs + interval '3 months - 1 day')::date - n;
    END IF;
    IF date_trunc('month', d)::date <> (qs + make_interval(months => LEAST(3, GREATEST(1, COALESCE(c.schedule_quarter_month, 1))) - 1))::date THEN
      RETURN false;
    END IF;
    RETURN dd = target;
  END IF;
  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.checklist_period_kind(public.checklists) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.checklist_period_start(public.checklists, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.checklist_period_end(public.checklists, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.checklist_shows_on(public.checklists, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_checklist_schedule_frequency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.template_type, 'standard') <> 'standard' THEN RETURN NEW; END IF;
  IF NEW.schedule_mode IS NULL AND NEW.schedule_repeats IS DISTINCT FROM false THEN RETURN NEW; END IF;
  IF NEW.schedule_repeats = false THEN
    NEW.frequency := 'single_day';
    NEW.visible_days_before_month_end := NULL;
    RETURN NEW;
  END IF;
  NEW.frequency := CASE
    WHEN NEW.schedule_period = 'quarter' THEN 'quarterly'
    WHEN NEW.schedule_period = 'month' THEN 'monthly'
    WHEN NEW.schedule_mode = 'days' AND COALESCE(array_length(NEW.schedule_weekdays, 1), 0) = 7 THEN 'daily'
    ELSE 'weekly' END;
  NEW.visible_days_before_month_end := CASE
    WHEN NEW.schedule_period = 'month' AND NEW.schedule_mode = 'last_n' THEN NEW.schedule_last_n ELSE NULL END;
  NEW.scheduled_date := NULL;
  NEW.assigned_day_of_week := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_checklist_schedule_frequency ON public.checklists;
CREATE TRIGGER trg_sync_checklist_schedule_frequency
  BEFORE INSERT OR UPDATE OF schedule_repeats, schedule_period, schedule_mode, schedule_weekdays, schedule_day, schedule_quarter_month, schedule_last_n, template_type
  ON public.checklists FOR EACH ROW EXECUTE FUNCTION public.sync_checklist_schedule_frequency();

DO $mig$
DECLARE
  def text; before text;
BEGIN
  SELECT pg_get_functiondef('public.check_alerts_sql()'::regprocedure) INTO def; before := def;
  def := replace(def, $a$AND (c.frequency = 'daily' OR c.template_type = 'dynamic')$a$,
    $a$AND (c.template_type = 'dynamic' OR (COALESCE(c.template_type, 'standard') <> 'training' AND public.checklist_period_kind(c) = 'day' AND public.checklist_shows_on(c, local_date::date)))$a$);
  def := replace(def, $a$SELECT c.id, c.title, c.visible_days_before_month_end
        FROM checklists c$a$, $a$SELECT c.id, c.title, c.visible_days_before_month_end,
          public.checklist_shows_on(c, local_date::date) AS p_shows,
          public.checklist_period_start(c, local_date::date) AS p_start,
          public.checklist_period_end(c, local_date::date) AS p_end
        FROM checklists c$a$);
  def := replace(def, $a$          AND c.frequency = 'monthly'
      LOOP
        IF days_until_month_end > COALESCE(mcl.visible_days_before_month_end, 5) THEN CONTINUE; END IF;$a$,
    $a$          AND COALESCE(c.template_type, 'standard') NOT IN ('dynamic', 'training')
          AND public.checklist_period_kind(c) IN ('month', 'quarter')
      LOOP
        IF NOT mcl.p_shows THEN CONTINUE; END IF;
        days_until_month_end := mcl.p_end - local_date::DATE;
        mc_start_of_month := (to_char(mcl.p_start, 'YYYY-MM-DD') || 'T00:00:00')::TIMESTAMP AT TIME ZONE tz;$a$);
  IF def = before OR position('p_shows' in def) = 0 OR position('mcl.p_end' in def) = 0 OR position($a$c.frequency = 'daily'$a$ in def) > 0 THEN
    RAISE EXCEPTION 'check_alerts_sql patch did not apply';
  END IF;
  EXECUTE def;

  SELECT pg_get_functiondef('public.check_weekly_checklist_alerts_sql()'::regprocedure) INTO def; before := def;
  def := replace(def, $a$        AND c.frequency = 'weekly'
        AND COALESCE(c.template_type, 'standard') <> 'dynamic'$a$, $a$        AND COALESCE(c.template_type, 'standard') NOT IN ('dynamic', 'training')
        AND public.checklist_period_kind(c) = 'week'$a$);
  IF def = before THEN RAISE EXCEPTION 'check_weekly_checklist_alerts_sql patch did not apply'; END IF;
  EXECUTE def;

  SELECT pg_get_functiondef('public.checklist_nudge_status(uuid, uuid)'::regprocedure) INTO def; before := def;
  def := replace(def, $a$      CASE WHEN c.frequency = 'monthly' THEN m_start ELSE w_start END AS ps,
      CASE WHEN c.frequency = 'monthly' THEN m_end ELSE w_end END AS pe$a$, $a$      CASE WHEN public.checklist_period_kind(c) IN ('week', 'month', 'quarter')
        THEN public.checklist_period_start(c, local_now::date)::timestamp AT TIME ZONE tz ELSE w_start END AS ps,
      CASE WHEN public.checklist_period_kind(c) IN ('week', 'month', 'quarter')
        THEN (public.checklist_period_end(c, local_now::date) + 1)::timestamp AT TIME ZONE tz ELSE w_end END AS pe$a$);
  def := replace(def, $a$        WHEN c.frequency = 'monthly' AND COALESCE(c.visible_days_before_month_end, 0) > 0 THEN days_left < c.visible_days_before_month_end
        ELSE true END)$a$, $a$        ELSE public.checklist_shows_on(c, local_now::date) END)$a$);
  IF def = before OR position('checklist_shows_on' in def) = 0 OR position('checklist_period_start' in def) = 0 THEN
    RAISE EXCEPTION 'checklist_nudge_status patch did not apply';
  END IF;
  EXECUTE def;

  SELECT pg_get_functiondef('public.duplicate_checklist_as_draft'::regproc) INTO def; before := def;
  def := replace(def, $a$    requires_manager_approval, scheduled_date,
$a$, $a$    requires_manager_approval, scheduled_date,
    schedule_repeats, schedule_period, schedule_mode, schedule_weekdays, schedule_day, schedule_quarter_month, schedule_last_n,
$a$);
  def := replace(def, $a$    src.scheduled_date,
$a$, $a$    src.scheduled_date,
    src.schedule_repeats, src.schedule_period, src.schedule_mode, src.schedule_weekdays, src.schedule_day, src.schedule_quarter_month, src.schedule_last_n,
$a$);
  IF def = before OR position('src.schedule_last_n' in def) = 0 THEN RAISE EXCEPTION 'duplicate_checklist_as_draft patch did not apply'; END IF;
  EXECUTE def;
END $mig$;