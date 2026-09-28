-- Stage 5 (Pack 3 server): one goal, stored pace, last-year = date - 364.
ALTER TABLE public.sales_cache ADD COLUMN IF NOT EXISTS pace_week_projection numeric;
ALTER TABLE public.sales_cache ADD COLUMN IF NOT EXISTS pace_month_projection numeric;

CREATE OR REPLACE FUNCTION public._resolve_goal(_location_id uuid, _date date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(NULLIF(sc.override_projection,0), NULLIF(sc.living_projection,0),
                  NULLIF(sc.initial_projection,0), NULLIF(sc.projected_sales,0))
  FROM public.sales_cache sc
  WHERE sc.location_id = _location_id AND sc.sale_date = _date
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._resolve_goal(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._resolve_goal(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public._sales_caller_ok(_location_id uuid, _min_role text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_role text := COALESCE(auth.jwt()->>'role', '');
BEGIN
  IF v_role = 'service_role' THEN RETURN true; END IF;
  IF v_uid IS NULL THEN
    RETURN current_setting('request.jwt.claims', true) IS NULL OR current_setting('request.jwt.claims', true) = '';
  END IF;
  IF public.punch_device_location(v_uid) = _location_id THEN RETURN true; END IF;
  IF _min_role IS NOT NULL AND NOT public.has_role_or_higher(v_uid, _min_role) THEN RETURN false; END IF;
  IF public.has_location_access(v_uid, _location_id) THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.locations l
    WHERE l.id = _location_id AND l.brand_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = l.brand_id AND bm.user_id = v_uid)
  );
END $$;
REVOKE ALL ON FUNCTION public._sales_caller_ok(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sales_caller_ok(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_goal(_location_id uuid, _date date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._sales_caller_ok(_location_id, NULL) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN public._resolve_goal(_location_id, _date);
END $$;
REVOKE ALL ON FUNCTION public.resolve_goal(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_goal(uuid, date) TO authenticated, service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr;

CREATE OR REPLACE FUNCTION public.get_sales_comparisons(_location_id uuid, _date date)
RETURNS TABLE(sale_date date, net_sales numeric, goal numeric,
              ly_date date, ly_net_sales numeric, ly_hourly_data jsonb,
              lw_net_sales numeric, wtd_net numeric, ly_wtd_net numeric,
              mtd_net numeric, ly_mtd_net numeric,
              pace_adjusted_projection numeric, pace_week_projection numeric,
              pace_month_projection numeric, pace_calculated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ws date := _date - ((EXTRACT(ISODOW FROM _date)::int) - 1);
        v_ms date := date_trunc('month', _date)::date;
BEGIN
  IF NOT public._sales_caller_ok(_location_id, 'shift_manager') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT _date,
    (SELECT s.net_sales FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date=_date),
    public._resolve_goal(_location_id, _date),
    _date - 364,
    (SELECT s.net_sales FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date=_date-364),
    (SELECT s.hourly_data FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date=_date-364),
    (SELECT s.net_sales FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date=_date-7),
    (SELECT COALESCE(sum(s.net_sales),0) FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date BETWEEN v_ws AND _date),
    (SELECT COALESCE(sum(s.net_sales),0) FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date BETWEEN v_ws-364 AND _date-364),
    (SELECT COALESCE(sum(s.net_sales),0) FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date BETWEEN v_ms AND _date),
    (SELECT COALESCE(sum(s.net_sales),0) FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date BETWEEN v_ms-364 AND _date-364),
    t.pace_adjusted_projection, t.pace_week_projection, t.pace_month_projection, t.pace_calculated_at
  FROM (SELECT 1) x
  LEFT JOIN sales_cache t ON t.location_id=_location_id AND t.sale_date=_date;
END $$;
REVOKE ALL ON FUNCTION public.get_sales_comparisons(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_comparisons(uuid, date) TO authenticated, service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr;

CREATE OR REPLACE FUNCTION public.send_hourly_sales_pulse()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  loc RECORD;
  tz TEXT;
  local_hours INTEGER;
  local_minutes INTEGER;
  local_day INTEGER;
  local_date TEXT;
  v_dedup_key TEXT;
  v_goal NUMERIC;
  v_net_sales NUMERIC;
  v_pace NUMERIC;
  v_labor_cost NUMERIC;
  v_labor_pct NUMERIC;
  v_body TEXT;
  v_user_ids UUID[];
  is_open BOOLEAN;
  open_hour INTEGER;
  close_hour INTEGER;
  v_pace_pct NUMERIC;
  v_status TEXT;
  v_hourly_data JSONB;
  v_elem JSONB;
  v_hour_num INTEGER;
  v_actual NUMERIC;
  v_projected NUMERIC;
  v_remain_frac NUMERIC;
  v_pace_sum NUMERIC;
  v_has_projections BOOLEAN;
  v_stored_pace NUMERIC;
  v_pace_at TIMESTAMPTZ;
  v_pace_fresh BOOLEAN;
BEGIN
  FOR loc IN
    SELECT l.id, l.name, COALESCE(ls.timezone, 'America/Los_Angeles') AS timezone
    FROM locations l
    LEFT JOIN LATERAL (
      SELECT timezone FROM location_settings WHERE location_id = l.id LIMIT 1
    ) ls ON true
    WHERE l.is_active = true
  LOOP
    tz := loc.timezone;
    local_hours := EXTRACT(HOUR FROM now() AT TIME ZONE tz)::INTEGER;
    local_minutes := EXTRACT(MINUTE FROM now() AT TIME ZONE tz)::INTEGER;
    local_day := EXTRACT(DOW FROM now() AT TIME ZONE tz)::INTEGER;
    local_date := to_char(now() AT TIME ZONE tz, 'YYYY-MM-DD');

    SELECT NOT lh.is_closed,
           EXTRACT(HOUR FROM lh.open_time)::INTEGER,
           EXTRACT(HOUR FROM lh.close_time)::INTEGER
    INTO is_open, open_hour, close_hour
    FROM location_hours lh
    WHERE lh.location_id = loc.id AND lh.day_of_week = local_day
    LIMIT 1;

    IF is_open IS NULL OR is_open = false THEN CONTINUE; END IF;
    IF local_hours < open_hour OR local_hours > close_hour THEN CONTINUE; END IF;
    IF local_hours <= open_hour THEN CONTINUE; END IF;

    SELECT 
      COALESCE(public._resolve_goal(loc.id, local_date::DATE), 0),
      COALESCE(sc.net_sales, 0),
      sc.hourly_data,
      sc.pace_adjusted_projection,
      sc.pace_calculated_at
    INTO v_goal, v_net_sales, v_hourly_data, v_stored_pace, v_pace_at
    FROM sales_cache sc
    WHERE sc.location_id = loc.id AND sc.sale_date = local_date::DATE
    LIMIT 1;

    IF v_goal IS NULL OR v_goal = 0 THEN CONTINUE; END IF;
    IF v_net_sales < 100 THEN CONTINUE; END IF;

    v_pace_fresh := v_stored_pace IS NOT NULL AND v_stored_pace > 0
                    AND v_pace_at IS NOT NULL AND v_pace_at >= now() - interval '15 minutes';
    IF v_pace_fresh THEN
      v_pace := GREATEST(v_stored_pace, v_net_sales);
      v_pace_pct := CASE WHEN v_goal > 0 THEN (v_pace / v_goal) * 100 ELSE 0 END;
      IF v_pace_pct >= 110 THEN v_status := '🔥 On fire';
      ELSIF v_pace_pct >= 100 THEN v_status := '✅ Ahead of pace';
      ELSIF v_pace_pct >= 95 THEN v_status := '➡️ On pace';
      ELSE v_status := '⚠️ Behind pace';
      END IF;
    ELSE
      v_pace := NULL; v_pace_pct := NULL; v_status := NULL;
    END IF;

    SELECT sl.cost, CASE WHEN v_net_sales > 0 THEN (sl.cost / v_net_sales) * 100 ELSE NULL END
    INTO v_labor_cost, v_labor_pct
    FROM public._store_labor(loc.id, public.business_date(loc.id), true) sl;

    v_dedup_key := 'hourly_pulse_' || loc.id::TEXT || '_' || local_date || '_' || local_hours::TEXT;

    IF EXISTS (SELECT 1 FROM alert_queue WHERE dedup_key = v_dedup_key) THEN
      CONTINUE;
    END IF;

    v_body := loc.name || CASE WHEN v_status IS NOT NULL THEN ' • ' || v_status ELSE '' END || E'\n' ||
              'Sales: $' || to_char(v_net_sales, 'FM999,999,990.00') ||
              ' / Goal: $' || to_char(v_goal, 'FM999,999,990.00') ||
              CASE WHEN v_pace_fresh THEN E'\n' || 'Pace: $' || to_char(v_pace, 'FM999,999,990.00') || ' (' || to_char(v_pace_pct, 'FM990.0') || '%)' ELSE '' END;

    IF v_labor_cost IS NOT NULL THEN
      v_body := v_body || E'\n' || 'Labor: $' || to_char(v_labor_cost, 'FM999,999,990.00') ||
                CASE WHEN v_labor_pct IS NOT NULL THEN ' (' || to_char(v_labor_pct, 'FM990.0') || '%)' ELSE '' END;
    END IF;

    SELECT array_agg(DISTINCT ul.user_id)
    INTO v_user_ids
    FROM user_locations ul
    JOIN user_roles ur ON ur.user_id = ul.user_id
    WHERE ul.location_id = loc.id
      AND ur.role IN ('super_admin','brand_admin','org_admin','admin','manager')
      AND EXISTS (
        SELECT 1 FROM public._org_role_notification_settings(loc.id) rns
        WHERE rns.role::text = ur.role::text
          AND rns.notification_type = 'hourly_sales_pulse'
          AND rns.enabled = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_notification_settings uns
        WHERE uns.user_id = ul.user_id
          AND uns.location_id = loc.id
          AND uns.notification_type = 'hourly_sales_pulse'
          AND uns.push_enabled = false
      );

    IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES (
      'hourly_sales_pulse',
      v_dedup_key,
      loc.id,
      jsonb_build_object(
        'user_ids', to_jsonb(v_user_ids),
        'title', 'Hourly Pulse — ' || loc.name,
        'body', v_body,
        'notification_type', 'hourly_sales_pulse',
        'data', jsonb_build_object(
          'type', 'hourly_sales_pulse',
          'location_id', loc.id,
          'hour', local_hours,
          'date', local_date,
          'pace_pct', v_pace_pct,
          'net_sales', v_net_sales,
          'goal', v_goal
        )
      )
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_day_part_pulse()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  loc RECORD;
  tz TEXT;
  local_hours INT;
  local_minutes INT;
  local_day INT;
  local_date TEXT;
  am_cutoff_h INT;
  am_cutoff_m INT;
  close_h INT;
  close_m INT;
  is_closed_today BOOLEAN;
  part TEXT;
  cutoff_hour_used INT;
  v_dedup_key TEXT;
  v_net_sales NUMERIC;
  v_goal NUMERIC;
  v_labor_cost NUMERIC;
  v_labor_pct NUMERIC;
  v_partial_sales NUMERIC;
  v_hourly JSONB;
  v_elem JSONB;
  v_hour_num INT;
  v_actual NUMERIC;
  v_body TEXT;
  v_title TEXT;
  v_user_ids UUID[];
BEGIN
  FOR loc IN
    SELECT l.id, l.name,
           COALESCE(ls.timezone, 'America/Los_Angeles') AS timezone,
           COALESCE(ls.day_part_am_cutoff, '16:00:00'::TIME) AS am_cutoff
    FROM locations l
    LEFT JOIN LATERAL (
      SELECT timezone, day_part_am_cutoff
      FROM location_settings WHERE location_id = l.id LIMIT 1
    ) ls ON true
    WHERE l.is_active = true
  LOOP
    tz := loc.timezone;
    local_hours   := EXTRACT(HOUR   FROM now() AT TIME ZONE tz)::INT;
    local_minutes := EXTRACT(MINUTE FROM now() AT TIME ZONE tz)::INT;
    local_day     := EXTRACT(DOW    FROM now() AT TIME ZONE tz)::INT;
    local_date    := to_char(now() AT TIME ZONE tz, 'YYYY-MM-DD');

    am_cutoff_h := EXTRACT(HOUR   FROM loc.am_cutoff)::INT;
    am_cutoff_m := EXTRACT(MINUTE FROM loc.am_cutoff)::INT;

    SELECT lh.is_closed,
           EXTRACT(HOUR   FROM lh.close_time)::INT,
           EXTRACT(MINUTE FROM lh.close_time)::INT
    INTO is_closed_today, close_h, close_m
    FROM location_hours lh
    WHERE lh.location_id = loc.id AND lh.day_of_week = local_day
    LIMIT 1;

    IF is_closed_today IS NULL OR is_closed_today = true THEN CONTINUE; END IF;

    -- Determine which day part (if any) fires now (15-min landing window)
    part := NULL;
    IF local_hours = am_cutoff_h AND local_minutes < 15 THEN
      part := 'am';
      cutoff_hour_used := am_cutoff_h;
    ELSIF close_h IS NOT NULL AND local_hours = close_h AND local_minutes < 15 THEN
      part := 'pm';
      cutoff_hour_used := close_h;
    END IF;

    IF part IS NULL THEN CONTINUE; END IF;

    v_dedup_key := 'day_part_pulse_' || loc.id::TEXT || '_' || local_date || '_' || part;
    IF EXISTS (SELECT 1 FROM alert_queue WHERE dedup_key = v_dedup_key) THEN CONTINUE; END IF;

    SELECT COALESCE(sc.net_sales, 0),
           COALESCE(public._resolve_goal(loc.id, local_date::DATE), 0),
           sc.hourly_data
    INTO v_net_sales, v_goal, v_hourly
    FROM sales_cache sc
    WHERE sc.location_id = loc.id AND sc.sale_date = local_date::DATE
    LIMIT 1;

    -- Partial sales through end of cutoff_hour_used - 1
    v_partial_sales := 0;
    IF v_hourly IS NOT NULL AND jsonb_typeof(v_hourly) = 'array' THEN
      FOR v_elem IN SELECT value FROM jsonb_array_elements(v_hourly) LOOP
        v_hour_num := COALESCE(LEFT(v_elem->>'hour', 2)::INT, 0);
        v_actual := COALESCE((v_elem->>'sales')::NUMERIC, 0);
        IF v_hour_num < cutoff_hour_used THEN
          v_partial_sales := v_partial_sales + v_actual;
        END IF;
      END LOOP;
    END IF;
    IF part = 'pm' THEN v_partial_sales := v_net_sales; END IF;

    SELECT sl.cost, CASE WHEN v_partial_sales > 0 THEN (sl.cost / v_partial_sales) * 100 ELSE NULL END
    INTO v_labor_cost, v_labor_pct
    FROM public._store_labor(loc.id, public.business_date(loc.id), true) sl;

    IF part = 'am' THEN
      v_title := 'AM Shift Pulse — ' || loc.name;
      v_body  := 'AM sales: $' || to_char(v_partial_sales, 'FM999,999,990.00');
    ELSE
      v_title := 'PM Shift Pulse — ' || loc.name;
      v_body  := 'Day total: $' || to_char(v_partial_sales, 'FM999,999,990.00');
    END IF;
    IF v_goal > 0 THEN
      v_body := v_body || ' / Goal: $' || to_char(v_goal, 'FM999,999,990.00');
    END IF;
    IF v_labor_cost IS NOT NULL THEN
      v_body := v_body || E'\nLabor: $' || to_char(v_labor_cost, 'FM999,999,990.00')
                || CASE WHEN v_labor_pct IS NOT NULL
                        THEN ' (' || to_char(v_labor_pct, 'FM990.0') || '%)' ELSE '' END;
    END IF;

    SELECT array_agg(DISTINCT ul.user_id)
    INTO v_user_ids
    FROM user_locations ul
    JOIN user_roles ur ON ur.user_id = ul.user_id
    WHERE ul.location_id = loc.id
      AND ur.role IN ('super_admin','brand_admin','org_admin','admin','manager')
      AND EXISTS (
        SELECT 1 FROM public._org_role_notification_settings(loc.id) rns
        WHERE rns.role::text = ur.role::text
          AND rns.notification_type = 'day_part_pulse'
          AND rns.enabled = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_notification_settings uns
        WHERE uns.user_id = ul.user_id
          AND uns.location_id = loc.id
          AND uns.notification_type = 'day_part_pulse'
          AND uns.push_enabled = false
      );

    IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN CONTINUE; END IF;

    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES (
      'day_part_pulse', v_dedup_key, loc.id,
      jsonb_build_object(
        'user_ids', to_jsonb(v_user_ids),
        'title', v_title,
        'body',  v_body,
        'notification_type', 'day_part_pulse',
        'data', jsonb_build_object(
          'type','day_part_pulse','location_id',loc.id,'part',part,'date',local_date
        )
      )
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$function$;