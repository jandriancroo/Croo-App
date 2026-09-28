ALTER TABLE public.labor_rules
  ADD COLUMN IF NOT EXISTS seventh_day_rule boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_ot_max_wage numeric NULL,
  ADD COLUMN IF NOT EXISTS workweek_start_dow smallint NOT NULL DEFAULT 1 CHECK (workweek_start_dow BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS daily_ot_window text NOT NULL DEFAULT 'business_day' CHECK (daily_ot_window IN ('business_day','rolling_24h'));

-- Pure classifier. _shifts: [{d,ci,co,h}] ; _rules: {d_ot,d_dt,w_ot,seventh,max_wage,window,wsdow}
-- Returns [{d, week_start, reg, ot, dt}] one per business day worked.
CREATE OR REPLACE FUNCTION public._payroll_classify(_shifts jsonb, _rules jsonb, _wage numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  d_ot numeric := COALESCE((_rules->>'d_ot')::numeric,0);
  d_dt numeric := COALESCE((_rules->>'d_dt')::numeric,0);
  w_ot numeric := COALESCE((_rules->>'w_ot')::numeric,40);
  seventh boolean := COALESCE((_rules->>'seventh')::boolean,false);
  maxw numeric := NULLIF(_rules->>'max_wage','')::numeric;
  win text := COALESCE(_rules->>'window','business_day');
  wsdow int := COALESCE((_rules->>'wsdow')::int,1);
  daily_on boolean := NOT (maxw IS NOT NULL AND _wage IS NOT NULL AND _wage >= maxw);
  s record; wk record; dy record;
  w_start timestamptz; acc numeric := 0; p numeric; rest numeric; frac numeric;
  extra numeric; take numeric; res jsonb := '[]'::jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _pc_days(d date PRIMARY KEY, ws date, h numeric, ot numeric, dt numeric) ON COMMIT DROP;
  TRUNCATE _pc_days;
  INSERT INTO _pc_days
    SELECT (x->>'d')::date, (x->>'d')::date - ((extract(dow from (x->>'d')::date)::int - wsdow + 7) % 7),
           sum(COALESCE((x->>'h')::numeric,0)), 0, 0
    FROM jsonb_array_elements(COALESCE(_shifts,'[]')) x GROUP BY 1,2;
  DELETE FROM _pc_days WHERE h <= 0;

  IF daily_on AND d_ot > 0 THEN
    IF win = 'rolling_24h' THEN
      FOR s IN SELECT (x->>'d')::date d, (x->>'ci')::timestamptz ci,
                      COALESCE((x->>'co')::timestamptz, (x->>'ci')::timestamptz + make_interval(secs => ((x->>'h')::numeric*3600)::float8)) co,
                      COALESCE((x->>'h')::numeric,0) h
               FROM jsonb_array_elements(COALESCE(_shifts,'[]')) x
               WHERE COALESCE((x->>'h')::numeric,0) > 0 ORDER BY (x->>'ci')::timestamptz LOOP
        rest := s.h;
        IF w_start IS NULL OR s.ci >= w_start + interval '24 hours' THEN w_start := s.ci; acc := 0; END IF;
        WHILE rest > 0 LOOP
          IF s.co > w_start + interval '24 hours' AND s.co > s.ci THEN
            frac := GREATEST(0, LEAST(1, extract(epoch from (w_start + interval '24 hours' - GREATEST(s.ci, w_start))) / extract(epoch from (s.co - s.ci))));
            p := LEAST(rest, round(s.h * frac, 6));
          ELSE p := rest; END IF;
          UPDATE _pc_days SET ot = ot + (GREATEST(acc + p - d_ot,0) - GREATEST(acc - d_ot,0)) WHERE d = s.d;
          acc := acc + p; rest := rest - p;
          IF rest > 0 THEN w_start := w_start + interval '24 hours'; acc := 0; END IF;
        END LOOP;
      END LOOP;
    ELSE
      UPDATE _pc_days SET
        dt = CASE WHEN d_dt > 0 THEN GREATEST(h - d_dt, 0) ELSE 0 END,
        ot = GREATEST(CASE WHEN d_dt > 0 THEN LEAST(h, d_dt) ELSE h END - d_ot, 0);
    END IF;
  END IF;

  IF daily_on AND seventh THEN
    FOR wk IN SELECT ws, max(d) last_d FROM _pc_days GROUP BY ws HAVING count(*) = 7 LOOP
      UPDATE _pc_days SET ot = LEAST(h, 8), dt = GREATEST(h - 8, 0) WHERE d = wk.last_d;
    END LOOP;
  END IF;

  FOR wk IN SELECT ws, sum(h) tot, sum(ot) dot, sum(dt) ddt FROM _pc_days GROUP BY ws LOOP
    extra := GREATEST(GREATEST(wk.tot - wk.ddt - w_ot, 0) - wk.dot, 0);
    FOR dy IN SELECT d, h - ot - dt reg FROM _pc_days WHERE ws = wk.ws ORDER BY d DESC LOOP
      EXIT WHEN extra <= 0;
      take := LEAST(extra, GREATEST(dy.reg, 0));
      UPDATE _pc_days SET ot = ot + take WHERE d = dy.d;
      extra := extra - take;
    END LOOP;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'week_start', ws, 'hours', round(h,4),
           'reg', round(h-ot-dt,4), 'ot', round(ot,4), 'dt', round(dt,4)) ORDER BY d), '[]'::jsonb)
    INTO res FROM _pc_days;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public._payroll_classify(jsonb, jsonb, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._payroll_classify(jsonb, jsonb, numeric) TO service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr;

CREATE OR REPLACE FUNCTION public.payroll_hours(_location_id uuid, _start date, _end date)
RETURNS TABLE(user_id uuid, full_name text, wage numeric, wage_missing boolean, regular_hours numeric,
  ot_hours numeric, dt_hours numeric, pto_hours numeric, total_paid_hours numeric, open_shift_count integer, weeks jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_org uuid; r record; v_rules jsonb; wsdow int;
  v_ws date; v_we date; u record; cls jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM locations WHERE id = _location_id;
  IF v_uid IS NULL OR _location_id IS NULL OR NOT (
       public.has_role(v_uid, 'super_admin')
    OR (v_org IS NOT NULL AND public.is_org_admin(v_uid, v_org))
    OR (public.has_role_or_higher(v_uid, 'manager') AND public.has_location_access(v_uid, _location_id))) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 31 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM labor_rules WHERE location_id = _location_id LIMIT 1;
  wsdow := COALESCE(r.workweek_start_dow, 1);
  v_rules := jsonb_build_object('d_ot', r.daily_overtime_threshold, 'd_dt', r.daily_double_time_threshold,
    'w_ot', COALESCE(r.weekly_overtime_threshold, 40), 'seventh', COALESCE(r.seventh_day_rule,false),
    'max_wage', r.daily_ot_max_wage, 'window', COALESCE(r.daily_ot_window,'business_day'), 'wsdow', wsdow);
  v_ws := _start - ((extract(dow from _start)::int - wsdow + 7) % 7);
  v_we := _end + (6 - ((extract(dow from _end)::int - wsdow + 7) % 7));

  CREATE TEMP TABLE IF NOT EXISTS _ph_shifts ON COMMIT DROP AS
    SELECT * FROM public.labor_shifts(_location_id, v_ws, v_we) WITH NO DATA;
  TRUNCATE _ph_shifts;
  INSERT INTO _ph_shifts SELECT * FROM public.labor_shifts(_location_id, v_ws, v_we);

  CREATE TEMP TABLE IF NOT EXISTS _ph_pto(user_id uuid PRIMARY KEY, h numeric) ON COMMIT DROP;
  TRUNCATE _ph_pto;
  INSERT INTO _ph_pto SELECT a.user_id, sum(COALESCE(a.hours_requested,0)) FROM availability_requests a
    WHERE a.location_id = _location_id AND a.status = 'approved' AND a.request_type IN ('paid','vacation','sick')
      AND a.start_date BETWEEN _start AND _end GROUP BY a.user_id;

  FOR u IN
    SELECT ids.uid,
      (SELECT s.wage FROM _ph_shifts s WHERE s.user_id = ids.uid AND COALESCE(s.wage,0) > 0 ORDER BY s.business_date DESC, s.clock_in DESC LIMIT 1) sw
    FROM (SELECT s.user_id uid FROM _ph_shifts s WHERE s.business_date BETWEEN _start AND _end
          UNION SELECT p.user_id FROM _ph_pto p) ids
  LOOP
    wage := COALESCE(u.sw, NULLIF(public.get_current_wage(u.uid, _end), 0));
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', s.business_date, 'ci', s.clock_in,
             'co', COALESCE(s.clock_out, s.estimated_end), 'h', s.paid_hours)), '[]'::jsonb)
      INTO cls FROM _ph_shifts s WHERE s.user_id = u.uid AND NOT COALESCE(s.resolved_zero,false);
    cls := public._payroll_classify(cls, v_rules, wage);
    user_id := u.uid;
    SELECT p.full_name INTO full_name FROM profiles p WHERE p.id = u.uid;
    wage_missing := wage IS NULL OR wage <= 0;
    SELECT COALESCE(sum((x->>'reg')::numeric),0), COALESCE(sum((x->>'ot')::numeric),0),
           COALESCE(sum((x->>'dt')::numeric),0), COALESCE(sum((x->>'hours')::numeric),0)
      INTO regular_hours, ot_hours, dt_hours, total_paid_hours
      FROM jsonb_array_elements(cls) x WHERE (x->>'d')::date BETWEEN _start AND _end;
    pto_hours := COALESCE((SELECT h FROM _ph_pto p WHERE p.user_id = u.uid), 0);
    open_shift_count := (SELECT count(*) FROM _ph_shifts s WHERE s.user_id = u.uid
      AND s.business_date BETWEEN _start AND _end AND s.missing_clock_out AND NOT COALESCE(s.resolved_zero,false))::int;
    SELECT COALESCE(jsonb_agg(w ORDER BY w->>'week_start'), '[]'::jsonb) INTO weeks FROM (
      SELECT jsonb_build_object('week_start', x->>'week_start', 'days_worked', count(*),
        'total', sum((x->>'hours')::numeric), 'reg', sum((x->>'reg')::numeric), 'ot', sum((x->>'ot')::numeric),
        'dt', sum((x->>'dt')::numeric),
        'in_period_hours', sum((x->>'hours')::numeric) FILTER (WHERE (x->>'d')::date BETWEEN _start AND _end)) w
      FROM jsonb_array_elements(cls) x GROUP BY x->>'week_start') q;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.payroll_hours(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_hours(uuid, date, date) TO authenticated, service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr;