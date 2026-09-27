-- ===== Shared pairing engine =====
CREATE OR REPLACE FUNCTION public._labor_pair_shifts(_location_id uuid, _date date, _live boolean, _new_rule boolean DEFAULT NULL)
RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_in timestamptz, clock_out timestamptz,
              worked_sec numeric, unpaid_sec numeric, paid_break_sec numeric,
              open_shift_live boolean, missing_clock_out boolean, unclosed_break_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  c_excluded constant uuid := '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d';
  v_now timestamptz := now();
  v_new boolean;
  v_n interval;
  v_ws timestamptz;
  v_we timestamptz;
  v_today date;
  v_uid uuid;
  r record;
  v_ss timestamptz;      -- open shift start
  v_sid uuid;            -- open shift clock_in punch id
  v_sd date;             -- open shift business date
  v_bs timestamptz;      -- open break start
  v_ign_out_at timestamptz;
  v_ign_bend_at timestamptz;
  v_unpaid interval;
  v_paidb interval;
  v_unc int;
  v_len interval;
BEGIN
  IF _location_id IS NULL OR _date IS NULL OR _location_id = c_excluded THEN
    RETURN;
  END IF;
  v_new := coalesce(_new_rule, _date >= public.labor_new_rule_start());

  SELECT make_interval(mins => coalesce(
           (SELECT lr.unpaid_break_min_minutes FROM public.labor_rules lr
             WHERE lr.location_id = _location_id ORDER BY lr.created_at LIMIT 1), 30))
    INTO v_n;
  SELECT w.start_at, w.end_at INTO v_ws, v_we FROM public.business_day_window(_location_id, _date) w;
  v_today := public.business_date(_location_id, v_now);

  FOR v_uid IN
    SELECT DISTINCT tp.user_id
      FROM public.time_punches tp
     WHERE tp.location_id = _location_id
       AND tp.user_id IS NOT NULL
       AND tp.punch_time >= v_ws - interval '24 hours'
       AND tp.punch_time <  v_we + interval '24 hours'
  LOOP
    v_ss := NULL; v_sid := NULL; v_sd := NULL; v_bs := NULL;
    v_ign_out_at := NULL; v_ign_bend_at := NULL;
    v_unpaid := interval '0'; v_paidb := interval '0'; v_unc := 0;

    FOR r IN
      SELECT d.punch_type, d.punch_time, d.id
        FROM (
          SELECT DISTINCT ON (tp.punch_time, tp.punch_type) tp.punch_type, tp.punch_time, tp.id
            FROM public.time_punches tp
           WHERE tp.location_id = _location_id
             AND tp.user_id = v_uid
             AND tp.punch_time >= v_ws - interval '24 hours'
             AND tp.punch_time <  v_we + interval '24 hours'
             AND tp.punch_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')
           ORDER BY tp.punch_time, tp.punch_type, tp.id
        ) d
       ORDER BY d.punch_time,
                CASE d.punch_type
                  WHEN 'break_end'   THEN 0
                  WHEN 'clock_out'   THEN 1
                  WHEN 'clock_in'    THEN 2
                  WHEN 'break_start' THEN 3
                END,
                d.id
    LOOP
      IF r.punch_type = 'clock_in' THEN
        IF v_ss IS NULL THEN
          IF v_ign_out_at IS NOT DISTINCT FROM r.punch_time THEN
            CONTINUE;  -- zero-length shift: drop the pair
          END IF;
          v_ss := r.punch_time; v_sid := r.id;
          v_sd := public.business_date(_location_id, r.punch_time);
          v_bs := NULL; v_unpaid := interval '0'; v_paidb := interval '0'; v_unc := 0;
        ELSIF v_new THEN
          IF v_bs IS NOT NULL THEN
            -- R16: clock_in during an open break = wrong button on return; close the break here.
            v_len := r.punch_time - v_bs;
            IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; ELSE v_paidb := v_paidb + v_len; END IF;
            v_unc := v_unc + 1;
            v_bs := NULL;
          ELSE
            -- R16: clock_in with a shift open and no break = forgotten clock-out. Earlier shift is 0h, flagged.
            IF v_sd = _date THEN
              user_id := v_uid; business_date := v_sd; clock_in_punch_id := v_sid;
              clock_in := v_ss; clock_out := NULL;
              worked_sec := 0; unpaid_sec := 0; paid_break_sec := 0;
              open_shift_live := false; missing_clock_out := true; unclosed_break_count := v_unc;
              RETURN NEXT;
            END IF;
            v_ss := r.punch_time; v_sid := r.id;
            v_sd := public.business_date(_location_id, r.punch_time);
            v_bs := NULL; v_unpaid := interval '0'; v_paidb := interval '0'; v_unc := 0;
          END IF;
        END IF;
        -- pre-cutoff: extra clock_in ignored (2A behaviour)

      ELSIF r.punch_type = 'clock_out' THEN
        IF v_ss IS NULL THEN
          v_ign_out_at := r.punch_time;
          CONTINUE;
        END IF;
        IF v_bs IS NOT NULL THEN
          v_unc := v_unc + 1;
          v_len := r.punch_time - v_bs;
          IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; ELSE v_paidb := v_paidb + v_len; END IF;
        END IF;
        IF v_sd = _date THEN
          user_id := v_uid; business_date := v_sd; clock_in_punch_id := v_sid;
          clock_in := v_ss; clock_out := r.punch_time;
          worked_sec := extract(epoch FROM (r.punch_time - v_ss));
          unpaid_sec := extract(epoch FROM v_unpaid);
          paid_break_sec := extract(epoch FROM v_paidb);
          open_shift_live := false; missing_clock_out := false; unclosed_break_count := v_unc;
          RETURN NEXT;
        END IF;
        v_ss := NULL; v_sid := NULL; v_sd := NULL; v_bs := NULL;
        v_unpaid := interval '0'; v_paidb := interval '0'; v_unc := 0;

      ELSIF r.punch_type = 'break_start' THEN
        IF v_ss IS NOT NULL AND v_bs IS NULL THEN
          IF v_ign_bend_at IS NOT DISTINCT FROM r.punch_time THEN
            CONTINUE;  -- zero-length break: drop the pair
          END IF;
          v_bs := r.punch_time;
        END IF;

      ELSIF r.punch_type = 'break_end' THEN
        IF v_bs IS NULL THEN
          v_ign_bend_at := r.punch_time;
          CONTINUE;
        END IF;
        v_len := r.punch_time - v_bs;
        IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; ELSE v_paidb := v_paidb + v_len; END IF;
        v_bs := NULL;
      END IF;
    END LOOP;

    -- Shift still open at the end of the punches.
    IF v_ss IS NOT NULL AND v_sd = _date THEN
      user_id := v_uid; business_date := v_sd; clock_in_punch_id := v_sid; clock_in := v_ss; clock_out := NULL;
      IF _live AND _date = v_today AND v_now > v_ss THEN
        IF v_bs IS NOT NULL THEN
          v_len := v_now - v_bs;
          IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; ELSE v_paidb := v_paidb + v_len; END IF;
        END IF;
        worked_sec := extract(epoch FROM (v_now - v_ss));
        unpaid_sec := extract(epoch FROM v_unpaid);
        paid_break_sec := extract(epoch FROM v_paidb);
        open_shift_live := true; missing_clock_out := false; unclosed_break_count := v_unc;
      ELSE
        -- Past shift with no clock_out counts zero. Pre-cutoff keeps 2A's quirk of carrying closed-break
        -- unpaid time into the user total; new-rule dates carry none.
        worked_sec := 0;
        unpaid_sec := CASE WHEN v_new THEN 0 ELSE extract(epoch FROM v_unpaid) END;
        paid_break_sec := 0;
        open_shift_live := false; missing_clock_out := true; unclosed_break_count := v_unc;
      END IF;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- Legacy 2A counted unclosed breaks only at clock_out; the trailing-missing row must add none.
-- (v_unc is 0 there for pre-cutoff because it resets on every shift start and at clock_out.)

-- ===== labor_day_user_totals: same signature/columns, now sums the engine =====
CREATE OR REPLACE FUNCTION public.labor_day_user_totals(_location_id uuid, _date date, _live boolean)
 RETURNS TABLE(user_id uuid, paid_hours numeric, unpaid_break_hours numeric, wage numeric, cost numeric, wage_missing boolean, open_shift boolean, unclosed_break_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH g AS (
    SELECT s.user_id,
           sum(s.worked_sec) AS worked,
           sum(s.unpaid_sec) AS unpaid,
           bool_or(s.missing_clock_out AND NOT s.open_shift_live) AS open_shift,
           sum(s.unclosed_break_count)::int AS unc
      FROM public._labor_pair_shifts(_location_id, _date, _live) s
     GROUP BY s.user_id
  ), w AS (
    SELECT g.*,
           coalesce(
             (SELECT wh.hourly_wage FROM public.wage_history wh
               WHERE wh.user_id = g.user_id AND wh.effective_date <= _date AND wh.hourly_wage IS NOT NULL
               ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
             (SELECT pr.hourly_wage FROM public.profiles pr WHERE pr.id = g.user_id)
           ) AS raw_wage
      FROM g
  )
  SELECT w.user_id,
         greatest(w.worked - w.unpaid, 0) / 3600,
         w.unpaid / 3600,
         coalesce(w.raw_wage, 15),
         (greatest(w.worked - w.unpaid, 0) / 3600) * coalesce(w.raw_wage, 15),
         w.raw_wage IS NULL,
         w.open_shift,
         w.unc
    FROM w
$function$;

-- ===== Resolutions =====
CREATE TABLE public.labor_shift_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  clock_in_punch_id uuid NOT NULL UNIQUE REFERENCES public.time_punches(id) ON DELETE CASCADE,
  resolved_by uuid NOT NULL DEFAULT auth.uid(),
  resolved_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_labor_shift_resolutions_location ON public.labor_shift_resolutions(location_id);
GRANT SELECT, INSERT ON public.labor_shift_resolutions TO authenticated;
GRANT ALL ON public.labor_shift_resolutions TO service_role;
REVOKE ALL ON public.labor_shift_resolutions FROM anon;
ALTER TABLE public.labor_shift_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers view shift resolutions" ON public.labor_shift_resolutions FOR SELECT TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Managers add shift resolutions" ON public.labor_shift_resolutions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_or_higher(auth.uid(), 'manager')
    AND public.has_location_access(auth.uid(), location_id)
    AND resolved_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.time_punches tp
                 WHERE tp.id = clock_in_punch_id AND tp.location_id = labor_shift_resolutions.location_id
                   AND tp.user_id = labor_shift_resolutions.user_id AND tp.punch_type = 'clock_in')
  );

-- ===== Per-shift list for Time Tracking (manager+, 45 days) =====
CREATE OR REPLACE FUNCTION public.labor_shifts(_location_id uuid, _start date, _end date)
RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_in timestamptz, clock_out timestamptz,
              paid_hours numeric, paid_break_min numeric, unpaid_break_min numeric, wage numeric, cost numeric,
              open_shift_live boolean, missing_clock_out boolean, unclosed_break boolean, ignored_duplicates integer,
              resolved_zero boolean, resolved_by uuid, resolved_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_d date;
  v_today date;
BEGIN
  IF v_uid IS NULL OR _location_id IS NULL
     OR NOT public.has_role_or_higher(v_uid, 'manager')
     OR NOT public.has_location_access(v_uid, _location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 44 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  v_today := public.business_date(_location_id);

  FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
    RETURN QUERY
      SELECT s.user_id, s.business_date, s.clock_in_punch_id, s.clock_in, s.clock_out,
             round(greatest(s.worked_sec - s.unpaid_sec, 0) / 3600, 4),
             round(s.paid_break_sec / 60, 2),
             round(s.unpaid_sec / 60, 2),
             wg.w,
             round((greatest(s.worked_sec - s.unpaid_sec, 0) / 3600) * wg.w, 2),
             s.open_shift_live, s.missing_clock_out, s.unclosed_break_count > 0,
             (SELECT (count(*) - count(DISTINCT (tp.punch_time, tp.punch_type)))::int
                FROM public.time_punches tp
               WHERE tp.location_id = _location_id AND tp.user_id = s.user_id
                 AND tp.punch_time >= s.clock_in
                 AND tp.punch_time <= coalesce(s.clock_out, s.clock_in)),
             (s.missing_clock_out AND lsr.id IS NOT NULL),
             CASE WHEN s.missing_clock_out THEN lsr.resolved_by END,
             CASE WHEN s.missing_clock_out THEN lsr.resolved_at END
        FROM public._labor_pair_shifts(_location_id, v_d, v_d = v_today, true) s
        LEFT JOIN public.labor_shift_resolutions lsr ON lsr.clock_in_punch_id = s.clock_in_punch_id
        CROSS JOIN LATERAL (
          SELECT coalesce(
            (SELECT wh.hourly_wage FROM public.wage_history wh
              WHERE wh.user_id = s.user_id AND wh.effective_date <= v_d AND wh.hourly_wage IS NOT NULL
              ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
            (SELECT pr.hourly_wage FROM public.profiles pr WHERE pr.id = s.user_id),
            15) AS w
        ) wg;
  END LOOP;
END;
$function$;

-- ===== Open issues for a pay period =====
CREATE OR REPLACE FUNCTION public._pay_period_open_issues(_start date, _end date)
RETURNS TABLE(location_id uuid, location_name text, user_id uuid, user_name text, business_date date,
              clock_in_punch_id uuid, clock_in timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_loc record;
  v_d date;
  v_today date;
BEGIN
  IF _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 44 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  FOR v_loc IN
    SELECT l.id, l.name FROM public.locations l
     WHERE l.id <> '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid
       AND EXISTS (
         SELECT 1 FROM public.time_punches tp
          WHERE tp.location_id = l.id
            AND tp.punch_time >= (SELECT w.start_at FROM public.business_day_window(l.id, _start) w)
            AND tp.punch_time <  (SELECT w.end_at FROM public.business_day_window(l.id, _end) w))
  LOOP
    v_today := public.business_date(v_loc.id);
    FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
      RETURN QUERY
        SELECT v_loc.id, v_loc.name, s.user_id, pr.full_name, s.business_date, s.clock_in_punch_id, s.clock_in
          FROM public._labor_pair_shifts(v_loc.id, v_d, v_d = v_today, true) s
          LEFT JOIN public.profiles pr ON pr.id = s.user_id
         WHERE s.missing_clock_out
           AND NOT EXISTS (SELECT 1 FROM public.labor_shift_resolutions r WHERE r.clock_in_punch_id = s.clock_in_punch_id);
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pay_period_open_issues(_period_id uuid)
RETURNS TABLE(location_id uuid, location_name text, user_id uuid, user_name text, business_date date,
              clock_in_punch_id uuid, clock_in timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role_or_higher(v_uid, 'manager') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT pp.start_date, pp.end_date INTO v_start, v_end FROM public.pay_periods pp WHERE pp.id = _period_id;
  IF v_start IS NULL THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT i.* FROM public._pay_period_open_issues(v_start, v_end) i
     WHERE public.has_location_access(v_uid, i.location_id);
END;
$function$;

-- ===== Close guard (R15) =====
CREATE OR REPLACE FUNCTION public.pay_period_close_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count int;
  v_list text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'closed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN RETURN NEW; END IF;  -- already closed: no re-check
  SELECT count(*),
         string_agg(i.location_name || ' – ' || coalesce(i.user_name, 'Unknown') || ' – ' || to_char(i.business_date, 'YYYY-MM-DD'),
                    '; ' ORDER BY i.location_name, i.business_date)
    INTO v_count, v_list
    FROM public._pay_period_open_issues(NEW.start_date, NEW.end_date) i;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot close pay period: % missing clock-out(s) not fixed or resolved: %', v_count, left(v_list, 1500)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_pay_period_close_guard BEFORE INSERT OR UPDATE ON public.pay_periods
  FOR EACH ROW EXECUTE FUNCTION public.pay_period_close_guard();

-- ===== Grants =====
REVOKE ALL ON FUNCTION public._labor_pair_shifts(uuid,date,boolean,boolean), public._pay_period_open_issues(date,date),
  public.pay_period_close_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_pair_shifts(uuid,date,boolean,boolean), public._pay_period_open_issues(date,date) TO service_role;
REVOKE ALL ON FUNCTION public.labor_shifts(uuid,date,date), public.pay_period_open_issues(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labor_shifts(uuid,date,date), public.pay_period_open_issues(uuid) TO authenticated, service_role;