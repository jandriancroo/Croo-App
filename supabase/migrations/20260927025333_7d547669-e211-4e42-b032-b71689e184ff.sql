-- Package A step 3: labor logic
-- A1: source by setting
CREATE OR REPLACE FUNCTION public.labor_source_for(_location_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_src text; v_n int;
BEGIN
  IF _location_id IS NULL THEN RETURN NULL; END IF;
  SELECT count(*) INTO v_n FROM public.location_integrations li
   WHERE li.location_id = _location_id AND li.is_active
     AND li.integration_type IN ('qubeyond','aloha','clover','toast')
     AND li.credentials->>'pull_labor' = 'true';
  IF v_n = 0 THEN RETURN 'punch_clock'; END IF;
  SELECT li.integration_type INTO v_src FROM public.location_integrations li
   WHERE li.location_id = _location_id AND li.is_active
     AND li.integration_type IN ('qubeyond','aloha','clover','toast')
     AND li.credentials->>'pull_labor' = 'true'
   ORDER BY li.created_at, li.id LIMIT 1;
  IF v_n > 1 THEN
    RAISE WARNING 'labor_source_for: % POS integrations pull labor at %, using oldest (%)', v_n, _location_id, v_src;
  END IF;
  RETURN v_src;
END;
$$;

-- A3/A4: pairing
DROP FUNCTION public._labor_pair_shifts(uuid, date, boolean, boolean);
CREATE FUNCTION public._labor_pair_shifts(_location_id uuid, _date date, _live boolean, _new_rule boolean DEFAULT NULL::boolean)
RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_in timestamptz, clock_out timestamptz,
  worked_sec numeric, unpaid_sec numeric, paid_break_sec numeric, open_shift_live boolean, missing_clock_out boolean,
  unclosed_break_count integer, clock_out_punch_id uuid, estimated_end timestamptz, estimated boolean, max_unpaid_break_sec numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_now timestamptz := now();
  v_new boolean;
  v_n interval;
  v_dup interval;
  v_ws timestamptz;
  v_we timestamptz;
  v_today date;
  v_uid uuid;
  r record;
  v_ss timestamptz;
  v_sid uuid;
  v_sd date;
  v_bs timestamptz;
  v_ign_out_at timestamptz;
  v_ign_bend_at timestamptz;
  v_unpaid interval;
  v_paidb interval;
  v_maxu interval;
  v_unc int;
  v_len interval;
  v_prev_id uuid;
  v_last_id uuid;
  v_est timestamptz;
  v_zero boolean;
BEGIN
  IF _location_id IS NULL OR _date IS NULL
     OR public.labor_source_for(_location_id) IS DISTINCT FROM 'punch_clock' THEN
    RETURN;
  END IF;
  v_new := coalesce(_new_rule, _date >= public.labor_new_rule_start());

  SELECT make_interval(mins => coalesce(lr.unpaid_break_min_minutes, 30)),
         make_interval(mins => coalesce(lr.duplicate_tap_minutes, 5))
    INTO v_n, v_dup
    FROM public.labor_rules lr WHERE lr.location_id = _location_id ORDER BY lr.created_at LIMIT 1;
  v_n := coalesce(v_n, interval '30 minutes');
  v_dup := coalesce(v_dup, interval '5 minutes');
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
    v_ign_out_at := NULL; v_ign_bend_at := NULL; v_prev_id := NULL;
    v_unpaid := interval '0'; v_paidb := interval '0'; v_maxu := interval '0'; v_unc := 0;

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
      v_last_id := v_prev_id;
      v_prev_id := r.id;

      IF r.punch_type = 'clock_in' THEN
        IF v_ss IS NULL THEN
          IF v_ign_out_at IS NOT DISTINCT FROM r.punch_time THEN
            CONTINUE;
          END IF;
          v_ss := r.punch_time; v_sid := r.id;
          v_sd := public.business_date(_location_id, r.punch_time);
          v_bs := NULL; v_unpaid := interval '0'; v_paidb := interval '0'; v_maxu := interval '0'; v_unc := 0;
        ELSIF v_new THEN
          IF v_bs IS NOT NULL THEN
            v_len := r.punch_time - v_bs;
            IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; v_maxu := greatest(v_maxu, v_len); ELSE v_paidb := v_paidb + v_len; END IF;
            v_unc := v_unc + 1;
            v_bs := NULL;
          ELSIF v_last_id IS NOT DISTINCT FROM v_sid AND r.punch_time - v_ss <= v_dup THEN
            -- A4: double tap. Shift counts from the first tap.
            CONTINUE;
          ELSE
            -- Forgotten clock-out: earlier shift gets its estimated end, flagged.
            IF v_sd = _date THEN
              v_zero := EXISTS (SELECT 1 FROM public.labor_shift_resolutions lsr
                                 WHERE lsr.clock_in_punch_id = v_sid AND lsr.resolution = 'zero');
              v_est := CASE WHEN v_zero THEN NULL ELSE public.labor_estimated_end(v_sid) END;
              user_id := v_uid; business_date := v_sd; clock_in_punch_id := v_sid;
              clock_in := v_ss; clock_out := NULL; clock_out_punch_id := NULL;
              IF v_zero OR v_est IS NULL OR v_est <= v_ss THEN
                worked_sec := 0; unpaid_sec := 0; paid_break_sec := 0; max_unpaid_break_sec := 0;
              ELSE
                worked_sec := extract(epoch FROM (v_est - v_ss));
                unpaid_sec := least(extract(epoch FROM v_unpaid), extract(epoch FROM (v_est - v_ss)));
                paid_break_sec := extract(epoch FROM v_paidb);
                max_unpaid_break_sec := extract(epoch FROM v_maxu);
              END IF;
              estimated_end := v_est; estimated := NOT v_zero;
              open_shift_live := false; missing_clock_out := NOT v_zero; unclosed_break_count := v_unc;
              RETURN NEXT;
            END IF;
            v_ss := r.punch_time; v_sid := r.id;
            v_sd := public.business_date(_location_id, r.punch_time);
            v_bs := NULL; v_unpaid := interval '0'; v_paidb := interval '0'; v_maxu := interval '0'; v_unc := 0;
          END IF;
        END IF;

      ELSIF r.punch_type = 'clock_out' THEN
        IF v_ss IS NULL THEN
          v_ign_out_at := r.punch_time;
          CONTINUE;
        END IF;
        IF v_bs IS NOT NULL THEN
          v_unc := v_unc + 1;
          v_len := r.punch_time - v_bs;
          IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; v_maxu := greatest(v_maxu, v_len); ELSE v_paidb := v_paidb + v_len; END IF;
        END IF;
        IF v_sd = _date THEN
          user_id := v_uid; business_date := v_sd; clock_in_punch_id := v_sid;
          clock_in := v_ss; clock_out := r.punch_time; clock_out_punch_id := r.id;
          worked_sec := extract(epoch FROM (r.punch_time - v_ss));
          unpaid_sec := extract(epoch FROM v_unpaid);
          paid_break_sec := extract(epoch FROM v_paidb);
          max_unpaid_break_sec := extract(epoch FROM v_maxu);
          estimated_end := NULL; estimated := false;
          open_shift_live := false; missing_clock_out := false; unclosed_break_count := v_unc;
          RETURN NEXT;
        END IF;
        v_ss := NULL; v_sid := NULL; v_sd := NULL; v_bs := NULL;
        v_unpaid := interval '0'; v_paidb := interval '0'; v_maxu := interval '0'; v_unc := 0;

      ELSIF r.punch_type = 'break_start' THEN
        IF v_ss IS NOT NULL AND v_bs IS NULL THEN
          IF v_ign_bend_at IS NOT DISTINCT FROM r.punch_time THEN
            CONTINUE;
          END IF;
          v_bs := r.punch_time;
        END IF;

      ELSIF r.punch_type = 'break_end' THEN
        IF v_bs IS NULL THEN
          v_ign_bend_at := r.punch_time;
          CONTINUE;
        END IF;
        v_len := r.punch_time - v_bs;
        IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; v_maxu := greatest(v_maxu, v_len); ELSE v_paidb := v_paidb + v_len; END IF;
        v_bs := NULL;
      END IF;
    END LOOP;

    -- Shift still open at the end of the punches.
    IF v_ss IS NOT NULL AND v_sd = _date THEN
      user_id := v_uid; business_date := v_sd; clock_in_punch_id := v_sid; clock_in := v_ss;
      clock_out := NULL; clock_out_punch_id := NULL;
      IF NOT v_new THEN
        -- Pre-cutoff: unchanged 2A behaviour.
        IF _live AND _date = v_today AND v_now > v_ss THEN
          IF v_bs IS NOT NULL THEN
            v_len := v_now - v_bs;
            IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; ELSE v_paidb := v_paidb + v_len; END IF;
          END IF;
          worked_sec := extract(epoch FROM (v_now - v_ss));
          unpaid_sec := extract(epoch FROM v_unpaid);
          paid_break_sec := extract(epoch FROM v_paidb);
          open_shift_live := true; missing_clock_out := false;
        ELSE
          worked_sec := 0;
          unpaid_sec := extract(epoch FROM v_unpaid);
          paid_break_sec := 0;
          open_shift_live := false; missing_clock_out := true;
        END IF;
        estimated_end := NULL; estimated := false; max_unpaid_break_sec := extract(epoch FROM v_maxu);
        unclosed_break_count := v_unc;
      ELSE
        v_zero := EXISTS (SELECT 1 FROM public.labor_shift_resolutions lsr
                           WHERE lsr.clock_in_punch_id = v_sid AND lsr.resolution = 'zero');
        v_est := CASE WHEN v_zero THEN NULL ELSE public.labor_estimated_end(v_sid) END;
        IF v_zero THEN
          worked_sec := 0; unpaid_sec := 0; paid_break_sec := 0; max_unpaid_break_sec := 0;
          estimated_end := NULL; estimated := false;
          open_shift_live := false; missing_clock_out := false;
        ELSIF _live AND v_now > v_ss AND v_est IS NOT NULL AND v_est >= v_now THEN
          -- Still inside its cap: counts live to now, even past the business-day cutoff.
          IF v_bs IS NOT NULL THEN
            v_len := v_now - v_bs;
            IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; v_maxu := greatest(v_maxu, v_len); ELSE v_paidb := v_paidb + v_len; END IF;
          END IF;
          worked_sec := extract(epoch FROM (v_now - v_ss));
          unpaid_sec := extract(epoch FROM v_unpaid);
          paid_break_sec := extract(epoch FROM v_paidb);
          max_unpaid_break_sec := extract(epoch FROM v_maxu);
          estimated_end := NULL; estimated := false;
          open_shift_live := true; missing_clock_out := false;
        ELSE
          IF v_est IS NULL OR v_est <= v_ss THEN
            worked_sec := 0; unpaid_sec := 0; paid_break_sec := 0;
          ELSE
            IF v_bs IS NOT NULL AND v_est > v_bs THEN
              v_len := v_est - v_bs;
              IF v_len >= v_n THEN v_unpaid := v_unpaid + v_len; v_maxu := greatest(v_maxu, v_len); ELSE v_paidb := v_paidb + v_len; END IF;
            END IF;
            worked_sec := extract(epoch FROM (v_est - v_ss));
            unpaid_sec := least(extract(epoch FROM v_unpaid), extract(epoch FROM (v_est - v_ss)));
            paid_break_sec := extract(epoch FROM v_paidb);
          END IF;
          max_unpaid_break_sec := extract(epoch FROM v_maxu);
          estimated_end := v_est; estimated := true;
          open_shift_live := false; missing_clock_out := true;
        END IF;
        unclosed_break_count := v_unc;
      END IF;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._labor_pair_shifts(uuid, date, boolean, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_pair_shifts(uuid, date, boolean, boolean) TO service_role;

-- A8: no invented wage
CREATE OR REPLACE FUNCTION public.labor_day_user_totals(_location_id uuid, _date date, _live boolean)
RETURNS TABLE(user_id uuid, paid_hours numeric, unpaid_break_hours numeric, wage numeric, cost numeric, wage_missing boolean, open_shift boolean, unclosed_break_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
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
         w.raw_wage,
         (greatest(w.worked - w.unpaid, 0) / 3600) * w.raw_wage,
         w.raw_wage IS NULL,
         w.open_shift,
         w.unc
    FROM w
$function$;

CREATE OR REPLACE FUNCTION public.labor_day_totals(_location_id uuid, _date date, _live boolean)
RETURNS TABLE(hours numeric, cost numeric, wage_missing_count integer, open_shift_count integer, unclosed_break_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
  SELECT round(coalesce(sum(u.paid_hours), 0), 4),
         round(coalesce(sum(u.cost), 0), 2),
         (count(*) FILTER (WHERE u.wage_missing AND u.paid_hours > 0))::int,
         (count(*) FILTER (WHERE u.open_shift))::int,
         coalesce(sum(u.unclosed_break_count), 0)::int
    FROM public.labor_day_user_totals(_location_id, _date, _live) u
$function$;

CREATE OR REPLACE FUNCTION public._labor_totals_for_date(_location_id uuid, _date date, _show_live boolean)
RETURNS TABLE(hours numeric, cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
  IF public.labor_source_for(_location_id) IS DISTINCT FROM 'punch_clock'
     OR _date IS NULL OR _date < public.labor_new_rule_start() THEN
    RETURN QUERY SELECT * FROM public._legacy_labor_totals_for_date(_location_id, _date, _show_live);
    RETURN;
  END IF;
  RETURN QUERY SELECT t.hours, t.cost FROM public.labor_day_totals(_location_id, _date, _show_live) t;
END;
$function$;

CREATE OR REPLACE FUNCTION public._store_labor(_location_id uuid, _date date, _live boolean)
RETURNS TABLE(source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_src text; v_today date; v_h numeric; v_c numeric; v_net numeric;
  v_live boolean := false; v_asof timestamptz; lc record;
BEGIN
  IF _location_id IS NULL OR _date IS NULL THEN RETURN; END IF;
  v_src := public.labor_source_for(_location_id);
  v_today := public.business_date(_location_id);

  SELECT sc.net_sales INTO v_net FROM public.sales_cache sc
   WHERE sc.location_id = _location_id AND sc.sale_date = _date
   ORDER BY sc.fetched_at DESC NULLS LAST LIMIT 1;

  IF v_src <> 'punch_clock' THEN
    SELECT l.labor_hours, l.labor_cost, l.fetched_at INTO v_h, v_c, v_asof
      FROM public.labor_cache l
     WHERE l.location_id = _location_id AND l.labor_date = _date AND l.source = v_src;
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
    SELECT l.* INTO lc FROM public.labor_cache l
     WHERE l.location_id = _location_id AND l.labor_date = _date AND l.source = 'punch_clock';
    IF FOUND AND NOT coalesce(lc.is_stale, false) AND coalesce(lc.labor_hours, 0) > 0 THEN
      v_h := lc.labor_hours; v_c := lc.labor_cost; v_asof := lc.fetched_at;
    ELSE
      SELECT t.hours, t.cost INTO v_h, v_c FROM public._legacy_labor_totals_for_date(_location_id, _date, false) t;
      v_asof := now();
    END IF;
  END IF;

  source := v_src; hours := v_h; cost := v_c; net_sales := v_net;
  labor_pct := CASE WHEN v_c IS NULL OR coalesce(v_net, 0) = 0 THEN NULL ELSE v_c / v_net * 100 END;
  is_live := v_live; as_of := v_asof;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_store_labor(_location_ids uuid[], _start date, _end date)
RETURNS TABLE(location_id uuid, date date, source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_loc uuid; v_d date;
  v_mgr boolean; v_tm boolean; v_dev boolean; v_today date;
BEGIN
  IF _location_ids IS NULL OR _start IS NULL OR _end IS NULL OR _end < _start
     OR (_end - _start) > 92 OR cardinality(_location_ids) > 100 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  FOREACH v_loc IN ARRAY _location_ids LOOP
    CONTINUE WHEN v_loc IS NULL;
    v_mgr := coalesce(v_uid IS NOT NULL
               AND public.has_role_or_higher(v_uid, 'shift_manager')
               AND (public.is_super_admin(v_uid)
                    OR public.has_location_access(v_uid, v_loc)
                    OR public.has_brand_access_via_location(v_uid, v_loc)), false);
    v_tm := NOT v_mgr AND coalesce(v_uid IS NOT NULL
               AND public.has_role_or_higher(v_uid, 'team_member')
               AND public.has_location_access(v_uid, v_loc)
               AND public._org_role_permission_enabled(v_loc, 'team_member', 'view_sales'), false);
    v_dev := coalesce(v_uid IS NOT NULL AND public.punch_device_location(v_uid) = v_loc, false);
    IF NOT v_mgr AND NOT v_tm AND NOT v_dev THEN
      RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
    END IF;
    v_today := public.business_date(v_loc);
    FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
      CONTINUE WHEN NOT (v_mgr OR v_tm) AND v_d <> v_today;
      RETURN QUERY
        SELECT v_loc, v_d, s.source, s.hours, s.cost, s.net_sales, s.labor_pct, s.is_live, s.as_of
          FROM public._store_labor(v_loc, v_d, v_d = v_today) s;
    END LOOP;
  END LOOP;
END;
$function$;

-- Kiosk functions: identical signatures/grants; POS-labor stores keep the legacy path.
CREATE OR REPLACE FUNCTION public.get_live_labor_totals(_location_id uuid, _date date)
RETURNS TABLE(hours numeric, cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_tz text; v_bd date; v_d date;
begin
  if not coalesce(
    public._labor_totals_authorized(_location_id)
    or coalesce(auth.uid() is not null and public.punch_device_location(auth.uid()) = _location_id, false),
    false
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  if public.labor_source_for(_location_id) is distinct from 'punch_clock' or _date is null then
    return query select * from public._legacy_get_live_labor_totals(_location_id, _date);
    return;
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.get_labor_totals_for_dates(_location_id uuid, _dates date[])
RETURNS TABLE(date date, hours numeric, cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
declare d date;
begin
  if not public._labor_totals_authorized(_location_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if public.labor_source_for(_location_id) is distinct from 'punch_clock' then
    return query select * from public._legacy_get_labor_totals_for_dates(_location_id, _dates);
    return;
  end if;
  foreach d in array _dates loop
    if d is null or d < public.labor_new_rule_start() then
      return query select d, t.hours, t.cost from public._legacy_labor_totals_for_date(_location_id, d, false) t;
    else
      return query select d, coalesce(s.hours, 0), coalesce(s.cost, 0) from public._store_labor(_location_id, d, false) s;
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_cut_savings_total(_location_id uuid, _cuts jsonb)
RETURNS TABLE(total_minutes integer, est_savings numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
declare v_e jsonb; v_n int; v_date date; v_minutes integer; v_savings numeric;
begin
  if not (
    coalesce(public._labor_totals_authorized(_location_id), false)
    or coalesce(auth.uid() is not null and public.punch_device_location(auth.uid()) = _location_id, false)
  ) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if public.labor_source_for(_location_id) is distinct from 'punch_clock' then
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
  return next;
end;
$function$;

-- A2: open issues scoped to the caller's stores
DROP FUNCTION public.pay_period_open_issues(uuid);
DROP FUNCTION public._pay_period_open_issues(date, date);
CREATE FUNCTION public._pay_period_open_issues(_start date, _end date, _user uuid)
RETURNS TABLE(location_id uuid, location_name text, user_id uuid, user_name text, business_date date,
  clock_in_punch_id uuid, clock_in timestamptz, kind text, blocking boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE v_loc record; v_d date; v_today date;
BEGIN
  IF _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 44 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  FOR v_loc IN
    SELECT l.id, l.name FROM public.locations l
     WHERE public.labor_source_for(l.id) = 'punch_clock'
       AND (_user IS NULL OR public.has_location_access(_user, l.id))
       AND EXISTS (
         SELECT 1 FROM public.time_punches tp
          WHERE tp.location_id = l.id
            AND tp.punch_time >= (SELECT w.start_at FROM public.business_day_window(l.id, _start) w)
            AND tp.punch_time <  (SELECT w.end_at FROM public.business_day_window(l.id, _end) w))
  LOOP
    v_today := public.business_date(v_loc.id);
    FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
      RETURN QUERY
        SELECT v_loc.id, v_loc.name, s.user_id, pr.full_name, s.business_date, s.clock_in_punch_id, s.clock_in,
               CASE WHEN s.missing_clock_out THEN 'missing_clock_out' ELSE 'auto_clock_out_unreviewed' END,
               s.missing_clock_out
          FROM public._labor_pair_shifts(v_loc.id, v_d, v_d = v_today, true) s
          LEFT JOIN public.profiles pr ON pr.id = s.user_id
          LEFT JOIN public.time_punches co ON co.id = s.clock_out_punch_id
         WHERE (s.missing_clock_out
                AND NOT EXISTS (SELECT 1 FROM public.labor_shift_resolutions r
                                 WHERE r.clock_in_punch_id = s.clock_in_punch_id AND r.resolution = 'zero'))
            OR (NOT s.missing_clock_out AND coalesce(co.is_auto_punched_out, false)
                AND NOT EXISTS (SELECT 1 FROM public.labor_shift_resolutions r
                                 WHERE r.clock_in_punch_id = s.clock_in_punch_id AND r.resolution = 'auto_reviewed'));
    END LOOP;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public._pay_period_open_issues(date, date, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pay_period_open_issues(date, date, uuid) TO service_role;

CREATE FUNCTION public.pay_period_open_issues(_period_id uuid)
RETURNS TABLE(location_id uuid, location_name text, user_id uuid, user_name text, business_date date,
  clock_in_punch_id uuid, clock_in timestamptz, kind text, blocking boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_start date; v_end date;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role_or_higher(v_uid, 'manager') THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT pp.start_date, pp.end_date INTO v_start, v_end FROM public.pay_periods pp WHERE pp.id = _period_id;
  IF v_start IS NULL THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT i.* FROM public._pay_period_open_issues(v_start, v_end, v_uid) i;
END;
$function$;
REVOKE ALL ON FUNCTION public.pay_period_open_issues(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pay_period_open_issues(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pay_period_close_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_count int; v_list text; v_user uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'closed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN RETURN NEW; END IF;
  v_user := coalesce(auth.uid(), NEW.closed_by);  -- null = unscoped, all stores
  SELECT count(*),
         string_agg(i.location_name || ' – ' || coalesce(i.user_name, 'Unknown') || ' – ' || to_char(i.business_date, 'YYYY-MM-DD'),
                    '; ' ORDER BY i.location_name, i.business_date)
    INTO v_count, v_list
    FROM public._pay_period_open_issues(NEW.start_date, NEW.end_date, v_user) i
   WHERE i.blocking;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'Cannot close pay period: % missing clock-out(s) not fixed or resolved: %', v_count, left(v_list, 1500)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

-- A5: shift list
DROP FUNCTION public.labor_shifts(uuid, date, date);
CREATE FUNCTION public.labor_shifts(_location_id uuid, _start date, _end date)
RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_in timestamptz, clock_out timestamptz,
  paid_hours numeric, paid_break_min numeric, unpaid_break_min numeric, wage numeric, cost numeric,
  open_shift_live boolean, missing_clock_out boolean, unclosed_break boolean, ignored_duplicates integer,
  resolved_zero boolean, resolved_by uuid, resolved_at timestamptz,
  clock_out_punch_id uuid, auto_clock_out boolean, auto_reviewed boolean, meal_break_missing boolean,
  estimated_end timestamptz, estimated boolean, wage_missing boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_d date; v_today date; v_mh numeric; v_md int;
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
  SELECT lr.meal_break_hours, lr.meal_break_duration INTO v_mh, v_md
    FROM public.labor_rules lr WHERE lr.location_id = _location_id ORDER BY lr.created_at LIMIT 1;

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
             coalesce(lsr.resolution = 'zero', false),
             CASE WHEN lsr.id IS NOT NULL THEN lsr.resolved_by END,
             CASE WHEN lsr.id IS NOT NULL THEN lsr.resolved_at END,
             s.clock_out_punch_id,
             coalesce(co.is_auto_punched_out, false),
             coalesce(lsr.resolution = 'auto_reviewed', false),
             CASE WHEN v_mh IS NULL THEN false
                  ELSE greatest(s.worked_sec - s.unpaid_sec, 0) > v_mh * 3600
                       AND coalesce(s.max_unpaid_break_sec, 0) < coalesce(v_md, 30) * 60 END,
             s.estimated_end, s.estimated,
             wg.w IS NULL
        FROM public._labor_pair_shifts(_location_id, v_d, v_d = v_today, true) s
        LEFT JOIN public.labor_shift_resolutions lsr ON lsr.clock_in_punch_id = s.clock_in_punch_id
        LEFT JOIN public.time_punches co ON co.id = s.clock_out_punch_id
        CROSS JOIN LATERAL (
          SELECT coalesce(
            (SELECT wh.hourly_wage FROM public.wage_history wh
              WHERE wh.user_id = s.user_id AND wh.effective_date <= v_d AND wh.hourly_wage IS NOT NULL
              ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
            (SELECT pr.hourly_wage FROM public.profiles pr WHERE pr.id = s.user_id)) AS w
        ) wg;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.labor_shifts(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.labor_shifts(uuid, date, date) TO authenticated, service_role;

-- A7: pulses read _store_labor
DO $do$
DECLARE v_def text; v_new text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['send_hourly_sales_pulse','send_day_part_pulse'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF f = 'send_hourly_sales_pulse' THEN
      v_new := regexp_replace(v_def,
        'SELECT lc\.labor_cost,\s*CASE WHEN v_net_sales > 0 THEN \(lc\.labor_cost / v_net_sales\) \* 100 ELSE NULL END\s*INTO v_labor_cost, v_labor_pct\s*FROM labor_cache lc.*?LIMIT 1;',
        'SELECT sl.cost, CASE WHEN v_net_sales > 0 THEN (sl.cost / v_net_sales) * 100 ELSE NULL END
    INTO v_labor_cost, v_labor_pct
    FROM public._store_labor(loc.id, public.business_date(loc.id), true) sl;');
    ELSE
      v_new := regexp_replace(v_def,
        'SELECT lc\.labor_cost,\s*CASE WHEN v_partial_sales > 0\s*THEN \(lc\.labor_cost / v_partial_sales\) \* 100 ELSE NULL END\s*INTO v_labor_cost, v_labor_pct\s*FROM labor_cache lc.*?LIMIT 1;',
        'SELECT sl.cost, CASE WHEN v_partial_sales > 0 THEN (sl.cost / v_partial_sales) * 100 ELSE NULL END
    INTO v_labor_cost, v_labor_pct
    FROM public._store_labor(loc.id, public.business_date(loc.id), true) sl;');
    END IF;
    IF v_new = v_def OR v_new ~ 'FROM labor_cache lc' THEN
      RAISE EXCEPTION 'pulse patch did not apply to %', f;
    END IF;
    EXECUTE v_new;
  END LOOP;
END
$do$;