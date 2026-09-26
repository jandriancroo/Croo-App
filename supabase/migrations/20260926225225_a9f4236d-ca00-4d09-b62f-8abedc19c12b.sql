-- ============================================================================
-- Pack 2A: One labor number (server side). Approved by Jordan Sep 26 2026.
-- Virginia St (5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d) is excluded from every
-- new code path and keeps today's logic via _legacy_* copies.
-- ============================================================================

-- 1) Per-location unpaid-break threshold (minutes). Default 30.
ALTER TABLE public.labor_rules
  ADD COLUMN IF NOT EXISTS unpaid_break_min_minutes integer NOT NULL DEFAULT 30;

-- 2) Exact copies of today's logic, used for Virginia St and for dates before
--    the new-rule cutoff. Made from the live definitions so they are byte-exact.
DO $mk$
DECLARE v text;
BEGIN
  v := pg_get_functiondef('public._labor_totals_for_date(uuid,date,boolean)'::regprocedure);
  v := replace(v, 'public._labor_totals_for_date(', 'public._legacy_labor_totals_for_date(');
  EXECUTE v;

  v := pg_get_functiondef('public.get_live_labor_totals(uuid,date)'::regprocedure);
  v := replace(v, 'public.get_live_labor_totals(', 'public._legacy_get_live_labor_totals(');
  v := replace(v, 'public._labor_totals_for_date(', 'public._legacy_labor_totals_for_date(');
  EXECUTE v;

  v := pg_get_functiondef('public.get_labor_totals_for_dates(uuid,date[])'::regprocedure);
  v := replace(v, 'public.get_labor_totals_for_dates(', 'public._legacy_get_labor_totals_for_dates(');
  v := replace(v, 'public._labor_totals_for_date(', 'public._legacy_labor_totals_for_date(');
  EXECUTE v;

  v := pg_get_functiondef('public.get_cut_savings_total(uuid,jsonb)'::regprocedure);
  v := replace(v, 'public.get_cut_savings_total(', 'public._legacy_get_cut_savings_total(');
  EXECUTE v;
END
$mk$;

-- 3) New-rule cutoff: business dates on/after this use the new math.
CREATE OR REPLACE FUNCTION public.labor_new_rule_start()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT DATE '2026-09-26' $$;

-- 4) Business date + business-day window.
-- Cutoff hour for calendar day D = (hour of close_time on D-1 + 3) % 24, default 5.
-- Roll back to yesterday only when the cutoff is between 1 and 11 (daytime-close guard)
-- AND the local hour is before the cutoff.
CREATE OR REPLACE FUNCTION public.business_date(_location_id uuid, _at timestamptz DEFAULT now())
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text;
  v_local timestamp;
  v_c int;
BEGIN
  SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');
  v_local := coalesce(_at, now()) AT TIME ZONE v_tz;

  SELECT (extract(hour FROM lh.close_time)::int + 3) % 24
    INTO v_c
    FROM public.location_hours lh
   WHERE lh.location_id = _location_id
     AND lh.day_of_week = extract(dow FROM (v_local::date - 1))::int
     AND lh.close_time IS NOT NULL
   LIMIT 1;
  v_c := coalesce(v_c, 5);

  IF v_c BETWEEN 1 AND 11 AND extract(hour FROM v_local)::int < v_c THEN
    RETURN v_local::date - 1;
  END IF;
  RETURN v_local::date;
END;
$$;

CREATE OR REPLACE FUNCTION public.business_day_window(_location_id uuid, _date date)
RETURNS TABLE(start_at timestamptz, end_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text;
  v_c1 int;
  v_c2 int;
BEGIN
  SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');

  -- Start hour of business day D uses the close of D-1; end uses the close of D.
  SELECT (extract(hour FROM lh.close_time)::int + 3) % 24 INTO v_c1
    FROM public.location_hours lh
   WHERE lh.location_id = _location_id AND lh.close_time IS NOT NULL
     AND lh.day_of_week = extract(dow FROM (_date - 1))::int LIMIT 1;
  SELECT (extract(hour FROM lh.close_time)::int + 3) % 24 INTO v_c2
    FROM public.location_hours lh
   WHERE lh.location_id = _location_id AND lh.close_time IS NOT NULL
     AND lh.day_of_week = extract(dow FROM _date)::int LIMIT 1;
  v_c1 := coalesce(v_c1, 5);
  v_c2 := coalesce(v_c2, 5);
  IF v_c1 NOT BETWEEN 1 AND 11 THEN v_c1 := 0; END IF;
  IF v_c2 NOT BETWEEN 1 AND 11 THEN v_c2 := 0; END IF;

  start_at := (_date::timestamp + make_interval(hours => v_c1)) AT TIME ZONE v_tz;
  end_at   := ((_date + 1)::timestamp + make_interval(hours => v_c2)) AT TIME ZONE v_tz;
  RETURN NEXT;
END;
$$;

-- 5) THE labor calculation (per person). One commented block.
--   * Punches read from window start -24h to window end +24h; a shift belongs to
--     business_date(clock_in) and only shifts on _date count.
--   * Same-kind duplicates at the same instant collapse to one.
--   * Tie order at one instant: break_end < clock_out < clock_in < break_start < id.
--   * Zero-length pairs: clock_out ignored (no open shift) then clock_in at the same
--     instant -> both dropped. Same for break_end/break_start with no open break.
--     With a shift already open, clock_out+clock_in at one instant is a boundary.
--   * clock_in while a shift is open: ignored. clock_out with no shift: ignored.
--   * break_start only inside an open shift with no open break (first wins);
--     unmatched/duplicate break_end ignored; open break closes at clock_out
--     (counted in unclosed_break_count).
--   * Break >= N minutes (labor_rules.unpaid_break_min_minutes, default 30, inclusive)
--     is unpaid: its full length is deducted. Shorter breaks stay paid.
--   * Past shift with no clock_out counts zero (open_shift). Live + business today:
--     open shift runs to now(); open break counts as worked until it reaches N, then
--     its whole elapsed length is deducted.
--   * Wage: wage_history effective_date <= _date (effective_date DESC, created_at DESC,
--     id DESC), then profiles.hourly_wage, then 15 (wage_missing).
--   * Straight time only. Exact interval math; nothing rounded here.
CREATE OR REPLACE FUNCTION public.labor_day_user_totals(_location_id uuid, _date date, _live boolean)
RETURNS TABLE(user_id uuid, paid_hours numeric, unpaid_break_hours numeric, wage numeric,
              cost numeric, wage_missing boolean, open_shift boolean, unclosed_break_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  c_excluded constant uuid := '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d';
  v_now timestamptz := now();
  v_n interval;
  v_ws timestamptz;
  v_we timestamptz;
  v_today date;
  v_uid uuid;
  r record;
  v_shift_start timestamptz;
  v_shift_date date;
  v_break_start timestamptz;
  v_ign_out_at timestamptz;
  v_ign_bend_at timestamptz;
  v_worked interval;
  v_unpaid interval;
  v_len interval;
  v_has boolean;
  v_open boolean;
  v_unclosed int;
  v_wage numeric;
  v_missing boolean;
  v_hours numeric;
BEGIN
  IF _location_id IS NULL OR _date IS NULL OR _location_id = c_excluded THEN
    RETURN;
  END IF;

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
    v_shift_start := NULL; v_shift_date := NULL; v_break_start := NULL;
    v_ign_out_at := NULL; v_ign_bend_at := NULL;
    v_worked := interval '0'; v_unpaid := interval '0';
    v_has := false; v_open := false; v_unclosed := 0;

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
        IF v_shift_start IS NULL THEN
          IF v_ign_out_at IS NOT DISTINCT FROM r.punch_time THEN
            CONTINUE;  -- zero-length shift: drop the pair
          END IF;
          v_shift_start := r.punch_time;
          v_shift_date := public.business_date(_location_id, r.punch_time);
          v_break_start := NULL;
        END IF;

      ELSIF r.punch_type = 'clock_out' THEN
        IF v_shift_start IS NULL THEN
          v_ign_out_at := r.punch_time;
          CONTINUE;
        END IF;
        IF v_shift_date = _date THEN
          v_has := true;
          IF v_break_start IS NOT NULL THEN
            v_unclosed := v_unclosed + 1;
            v_len := r.punch_time - v_break_start;
            IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; END IF;
          END IF;
          v_worked := v_worked + (r.punch_time - v_shift_start);
        END IF;
        v_shift_start := NULL; v_shift_date := NULL; v_break_start := NULL;

      ELSIF r.punch_type = 'break_start' THEN
        IF v_shift_start IS NOT NULL AND v_break_start IS NULL THEN
          IF v_ign_bend_at IS NOT DISTINCT FROM r.punch_time THEN
            CONTINUE;  -- zero-length break: drop the pair
          END IF;
          v_break_start := r.punch_time;
        END IF;

      ELSIF r.punch_type = 'break_end' THEN
        IF v_break_start IS NULL THEN
          v_ign_bend_at := r.punch_time;
          CONTINUE;
        END IF;
        IF v_shift_date = _date THEN
          v_len := r.punch_time - v_break_start;
          IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; END IF;
        END IF;
        v_break_start := NULL;
      END IF;
    END LOOP;

    -- Shift still open at the end of the punches.
    IF v_shift_start IS NOT NULL AND v_shift_date = _date THEN
      IF _live AND _date = v_today AND v_now > v_shift_start THEN
        v_has := true;
        IF v_break_start IS NOT NULL THEN
          v_len := v_now - v_break_start;
          IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; END IF;
        END IF;
        v_worked := v_worked + (v_now - v_shift_start);
      ELSE
        v_open := true;  -- past shift with no clock_out counts zero
      END IF;
    END IF;

    CONTINUE WHEN NOT v_has AND NOT v_open;

    v_wage := NULL;
    SELECT wh.hourly_wage INTO v_wage
      FROM public.wage_history wh
     WHERE wh.user_id = v_uid
       AND wh.effective_date <= _date
       AND wh.hourly_wage IS NOT NULL
     ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC
     LIMIT 1;
    IF v_wage IS NULL THEN
      SELECT pr.hourly_wage INTO v_wage FROM public.profiles pr WHERE pr.id = v_uid;
    END IF;
    v_missing := v_wage IS NULL;
    v_wage := coalesce(v_wage, 15);

    v_hours := greatest(extract(epoch FROM (v_worked - v_unpaid)), 0) / 3600;

    user_id := v_uid;
    paid_hours := v_hours;
    unpaid_break_hours := extract(epoch FROM v_unpaid) / 3600;
    wage := v_wage;
    cost := v_hours * v_wage;
    wage_missing := v_missing;
    open_shift := v_open;
    unclosed_break_count := v_unclosed;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.labor_day_totals(_location_id uuid, _date date, _live boolean)
RETURNS TABLE(hours numeric, cost numeric, wage_missing_count integer,
              open_shift_count integer, unclosed_break_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT round(coalesce(sum(u.paid_hours), 0), 4),
         round(coalesce(sum(u.cost), 0), 2),
         (count(*) FILTER (WHERE u.wage_missing AND u.paid_hours > 0))::int,
         (count(*) FILTER (WHERE u.open_shift))::int,
         coalesce(sum(u.unclosed_break_count), 0)::int
    FROM public.labor_day_user_totals(_location_id, _date, _live) u
  HAVING _location_id IS DISTINCT FROM '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid
$$;

-- 6) One store labor lookup.
CREATE OR REPLACE FUNCTION public.labor_source_for(_location_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _location_id IS NULL OR _location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.location_integrations li
       WHERE li.location_id = _location_id
         AND li.integration_type = 'qubeyond'
         AND li.is_active
         AND li.credentials->>'pull_labor' = 'true'
    ) THEN 'qubeyond'
    ELSE 'punch_clock'
  END
$$;

CREATE OR REPLACE FUNCTION public._store_labor(_location_id uuid, _date date, _live boolean)
RETURNS TABLE(source text, hours numeric, cost numeric, net_sales numeric,
              labor_pct numeric, is_live boolean, as_of timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_src text;
  v_today date;
  v_h numeric;
  v_c numeric;
  v_net numeric;
  v_live boolean := false;
  v_asof timestamptz;
  lc record;
BEGIN
  IF _location_id IS NULL OR _date IS NULL
     OR _location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid THEN
    RETURN;
  END IF;

  v_src := public.labor_source_for(_location_id);
  v_today := public.business_date(_location_id);

  SELECT sc.net_sales INTO v_net
    FROM public.sales_cache sc
   WHERE sc.location_id = _location_id AND sc.sale_date = _date
   ORDER BY sc.fetched_at DESC NULLS LAST
   LIMIT 1;

  IF v_src = 'qubeyond' THEN
    SELECT l.labor_hours, l.labor_cost, l.fetched_at INTO v_h, v_c, v_asof
      FROM public.labor_cache l
     WHERE l.location_id = _location_id AND l.labor_date = _date AND l.source = 'qubeyond';
    v_live := (_date = v_today);

  ELSIF _date = v_today THEN
    SELECT t.hours, t.cost INTO v_h, v_c FROM public.labor_day_totals(_location_id, _date, _live) t;
    v_live := coalesce(_live, false);
    v_asof := now();

  ELSIF _date >= public.labor_new_rule_start() THEN
    SELECT l.* INTO lc FROM public.labor_cache l
     WHERE l.location_id = _location_id AND l.labor_date = _date AND l.source = 'punch_clock';
    IF FOUND AND NOT coalesce(lc.is_stale, false) THEN
      v_h := lc.labor_hours; v_c := lc.labor_cost; v_asof := lc.fetched_at;
    ELSE
      SELECT t.hours, t.cost INTO v_h, v_c FROM public.labor_day_totals(_location_id, _date, false) t;
      v_asof := now();
    END IF;

  ELSE
    -- Before the cutoff: old math only. Cached row when usable, else today's old calculation.
    SELECT l.* INTO lc FROM public.labor_cache l
     WHERE l.location_id = _location_id AND l.labor_date = _date AND l.source = 'punch_clock';
    IF FOUND AND NOT coalesce(lc.is_stale, false) AND coalesce(lc.labor_hours, 0) > 0 THEN
      v_h := lc.labor_hours; v_c := lc.labor_cost; v_asof := lc.fetched_at;
    ELSE
      SELECT t.hours, t.cost INTO v_h, v_c
        FROM public._legacy_labor_totals_for_date(_location_id, _date, false) t;
      v_asof := now();
    END IF;
  END IF;

  source := v_src;
  hours := v_h;
  cost := v_c;
  net_sales := v_net;
  labor_pct := CASE WHEN v_c IS NULL OR coalesce(v_net, 0) = 0 THEN NULL ELSE v_c / v_net * 100 END;
  is_live := v_live;
  as_of := v_asof;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_store_labor(_location_ids uuid[], _start date, _end date)
RETURNS TABLE(location_id uuid, date date, source text, hours numeric, cost numeric,
              net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_loc uuid;
  v_d date;
  v_mgr boolean;
  v_dev boolean;
  v_today date;
BEGIN
  IF _location_ids IS NULL OR _start IS NULL OR _end IS NULL OR _end < _start
     OR (_end - _start) > 92 OR cardinality(_location_ids) > 100 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;

  FOREACH v_loc IN ARRAY _location_ids LOOP
    CONTINUE WHEN v_loc IS NULL OR v_loc = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid;
    v_mgr := coalesce(public._labor_totals_authorized(v_loc), false);
    v_dev := coalesce(auth.uid() IS NOT NULL AND public.punch_device_location(auth.uid()) = v_loc, false);
    IF NOT v_mgr AND NOT v_dev THEN
      RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
    END IF;
    v_today := public.business_date(v_loc);

    FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
      CONTINUE WHEN NOT v_mgr AND v_d <> v_today;  -- paired device: business today only
      RETURN QUERY
        SELECT v_loc, v_d, s.source, s.hours, s.cost, s.net_sales, s.labor_pct, s.is_live, s.as_of
          FROM public._store_labor(v_loc, v_d, v_d = v_today) s;
    END LOOP;
  END LOOP;
END;
$$;

-- 7) Repointed existing functions (CREATE OR REPLACE keeps their ACLs).
--    Access checks are kept exactly as they are today.
CREATE OR REPLACE FUNCTION public._labor_totals_for_date(_location_id uuid, _date date, _show_live boolean)
RETURNS TABLE(hours numeric, cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid
     OR _date IS NULL OR _date < public.labor_new_rule_start() THEN
    RETURN QUERY SELECT * FROM public._legacy_labor_totals_for_date(_location_id, _date, _show_live);
    RETURN;
  END IF;
  RETURN QUERY SELECT t.hours, t.cost FROM public.labor_day_totals(_location_id, _date, _show_live) t;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_live_labor_totals(_location_id uuid, _date date)
RETURNS TABLE(hours numeric, cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text;
  v_bd date;
  v_d date;
begin
  if not coalesce(
    public._labor_totals_authorized(_location_id)
    or coalesce(
      auth.uid() is not null
      and public.punch_device_location(auth.uid()) = _location_id,
      false
    ),
    false
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if _location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid or _date is null then
    return query select * from public._legacy_get_live_labor_totals(_location_id, _date);
    return;
  end if;

  -- Kiosk sends the local calendar date; after midnight but before the cutoff that is
  -- business_date + 1, which means "business today".
  select ls.timezone into v_tz from public.location_settings ls where ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');
  v_bd := public.business_date(_location_id);
  v_d := _date;
  if _date = v_bd + 1 and _date = (now() at time zone v_tz)::date then
    v_d := v_bd;
  end if;

  if v_d < public.labor_new_rule_start() then
    return query select * from public._legacy_get_live_labor_totals(_location_id, _date);
    return;
  end if;

  return query
    select coalesce(s.hours, 0), coalesce(s.cost, 0)
      from public._store_labor(_location_id, v_d, true) s;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_labor_totals_for_dates(_location_id uuid, _dates date[])
RETURNS TABLE(date date, hours numeric, cost numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  d date;
begin
  if not public._labor_totals_authorized(_location_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if _location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid then
    return query select * from public._legacy_get_labor_totals_for_dates(_location_id, _dates);
    return;
  end if;

  foreach d in array _dates loop
    if d is null or d < public.labor_new_rule_start() then
      return query
        select d, t.hours, t.cost
          from public._legacy_labor_totals_for_date(_location_id, d, false) t;
    else
      return query
        select d, coalesce(s.hours, 0), coalesce(s.cost, 0)
          from public._store_labor(_location_id, d, false) s;
    end if;
  end loop;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_cut_savings_total(_location_id uuid, _cuts jsonb)
RETURNS TABLE(total_minutes integer, est_savings numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_e jsonb;
  v_n int;
  v_date date;
  v_minutes integer;
  v_savings numeric;
begin
  -- Authorization first (same gate as get_live_labor_totals).
  if not (
    coalesce(public._labor_totals_authorized(_location_id), false)
    or coalesce(auth.uid() is not null and public.punch_device_location(auth.uid()) = _location_id, false)
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if _location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid then
    return query select * from public._legacy_get_cut_savings_total(_location_id, _cuts);
    return;
  end if;

  if _cuts is null or jsonb_typeof(_cuts) <> 'array' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(_cuts);
  if v_n < 1 or v_n > 50 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  for v_e in select value from jsonb_array_elements(_cuts) loop
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e->'user_id') is distinct from 'string'
       or jsonb_typeof(v_e->'minutes') is distinct from 'number'
       or (v_e->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (v_e->>'minutes') !~ '^[0-9]{1,4}$' then
      raise exception 'invalid input' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct lower(value->>'user_id')) from jsonb_array_elements(_cuts)) <> v_n then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  -- Server-derived business date. Only people with a shift at this store that
  -- business day are priced; minutes clamped to 0..480. Never returns a wage.
  v_date := public.business_date(_location_id);

  with c as (
    select (value->>'user_id')::uuid as uid,
           least(greatest((value->>'minutes')::int, 0), 480) as minutes
      from jsonb_array_elements(_cuts)
  )
  select coalesce(sum(c.minutes), 0)::int,
         coalesce(sum(c.minutes * u.wage / 60.0), 0)
    into v_minutes, v_savings
    from c
    join public.labor_day_user_totals(_location_id, v_date, true) u on u.user_id = c.uid
   where c.minutes > 0;

  total_minutes := v_minutes;
  est_savings := round(v_savings, 2);
  return next; -- always exactly one row
end;
$$;

-- 8) Explicit grants (default privileges would otherwise expose new functions).
REVOKE ALL ON FUNCTION public._store_labor(uuid,date,boolean), public.labor_source_for(uuid), public.labor_day_totals(uuid,date,boolean), public.labor_day_user_totals(uuid,date,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._store_labor(uuid,date,boolean), public.labor_source_for(uuid), public.labor_day_totals(uuid,date,boolean), public.labor_day_user_totals(uuid,date,boolean) TO service_role;
REVOKE ALL ON FUNCTION public._legacy_labor_totals_for_date(uuid,date,boolean), public._legacy_get_live_labor_totals(uuid,date), public._legacy_get_labor_totals_for_dates(uuid,date[]), public._legacy_get_cut_savings_total(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._legacy_labor_totals_for_date(uuid,date,boolean), public._legacy_get_live_labor_totals(uuid,date), public._legacy_get_labor_totals_for_dates(uuid,date[]), public._legacy_get_cut_savings_total(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.get_store_labor(uuid[],date,date), public.business_date(uuid,timestamptz), public.business_day_window(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_labor(uuid[],date,date), public.business_date(uuid,timestamptz), public.business_day_window(uuid,date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.labor_new_rule_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_new_rule_start() TO service_role;

-- 9) Piggyback: customer admins must not manage CrooHQ's internal changelog.
DROP POLICY IF EXISTS "Admins can manage changelog" ON public.changelog_entries;