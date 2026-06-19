
-- 1) Per-location AM cutoff for Day Part Pulse
ALTER TABLE public.location_settings
  ADD COLUMN IF NOT EXISTS day_part_am_cutoff TIME NOT NULL DEFAULT '16:00:00';

-- 2) Day Part Pulse dispatcher (AM at cutoff, PM at close)
CREATE OR REPLACE FUNCTION public.send_day_part_pulse()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
           COALESCE(
             NULLIF(sc.override_projection, 0),
             NULLIF(sc.living_projection, 0),
             NULLIF(sc.initial_projection, 0),
             NULLIF(sc.projected_sales, 0),
             0
           ),
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

    SELECT lc.labor_cost,
           CASE WHEN v_partial_sales > 0
                THEN (lc.labor_cost / v_partial_sales) * 100 ELSE NULL END
    INTO v_labor_cost, v_labor_pct
    FROM labor_cache lc
    WHERE lc.location_id = loc.id AND lc.labor_date = local_date::DATE
    ORDER BY CASE WHEN lc.source = 'punch_clock' THEN 0 ELSE 1 END
    LIMIT 1;

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
        SELECT 1 FROM role_notification_settings rns
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

-- 3) Shift overstay alerts (>5 min past scheduled end, still clocked in)
CREATE OR REPLACE FUNCTION public.send_shift_overstay_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  tz TEXT;
  v_user_name TEXT;
  v_dedup_key TEXT;
  v_user_ids UUID[];
  v_minutes_over INT;
BEGIN
  FOR rec IN
    WITH last_punches AS (
      SELECT DISTINCT ON (tp.user_id, tp.location_id)
        tp.id AS punch_id, tp.user_id, tp.location_id, tp.shift_id,
        tp.punch_type, tp.punch_time
      FROM time_punches tp
      WHERE tp.punch_time > now() - INTERVAL '24 hours'
      ORDER BY tp.user_id, tp.location_id, tp.punch_time DESC
    )
    SELECT lp.punch_id, lp.user_id, lp.location_id, lp.shift_id, lp.punch_time,
           ss.shift_date, ss.end_time,
           COALESCE(ls.timezone, 'America/Los_Angeles') AS timezone,
           l.name AS location_name
    FROM last_punches lp
    JOIN scheduled_shifts ss ON ss.id = lp.shift_id
    JOIN locations l ON l.id = lp.location_id
    LEFT JOIN LATERAL (
      SELECT timezone FROM location_settings WHERE location_id = lp.location_id LIMIT 1
    ) ls ON true
    WHERE lp.punch_type = 'clock_in'
      AND ss.end_time IS NOT NULL
  LOOP
    tz := rec.timezone;

    v_minutes_over := EXTRACT(EPOCH FROM (
      now() - ((rec.shift_date::TEXT || ' ' || rec.end_time::TEXT)::TIMESTAMP AT TIME ZONE tz)
    )) / 60;

    IF v_minutes_over < 5 OR v_minutes_over > 120 THEN CONTINUE; END IF;

    v_dedup_key := 'overstay_' || rec.punch_id::TEXT;
    IF EXISTS (SELECT 1 FROM alert_queue WHERE dedup_key = v_dedup_key) THEN CONTINUE; END IF;

    SELECT COALESCE(p.first_name || ' ' || p.last_name, p.first_name, 'Team member')
    INTO v_user_name FROM profiles p WHERE p.id = rec.user_id;

    -- Recipients: the employee + managers/admins at the location (respect per-user opt-out)
    SELECT array_agg(DISTINCT uid)
    INTO v_user_ids
    FROM (
      SELECT rec.user_id AS uid
      WHERE NOT EXISTS (
        SELECT 1 FROM user_notification_settings uns
        WHERE uns.user_id = rec.user_id
          AND uns.location_id = rec.location_id
          AND uns.notification_type = 'shift_overstay'
          AND uns.push_enabled = false
      )
      UNION
      SELECT ul.user_id
      FROM user_locations ul
      JOIN user_roles ur ON ur.user_id = ul.user_id
      WHERE ul.location_id = rec.location_id
        AND ur.role IN ('super_admin','brand_admin','org_admin','admin','manager')
        AND NOT EXISTS (
          SELECT 1 FROM user_notification_settings uns
          WHERE uns.user_id = ul.user_id
            AND uns.location_id = rec.location_id
            AND uns.notification_type = 'shift_overstay'
            AND uns.push_enabled = false
        )
    ) recipients;

    IF v_user_ids IS NULL OR array_length(v_user_ids, 1) IS NULL THEN CONTINUE; END IF;

    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES (
      'shift_overstay', v_dedup_key, rec.location_id,
      jsonb_build_object(
        'user_ids', to_jsonb(v_user_ids),
        'title', '⏱️ Still clocked in — ' || rec.location_name,
        'body',  v_user_name || ' is ' || v_minutes_over::TEXT || ' min past shift end. Clock out reminder.',
        'notification_type', 'shift_overstay',
        'data', jsonb_build_object(
          'type','shift_overstay',
          'location_id', rec.location_id,
          'user_id', rec.user_id,
          'shift_id', rec.shift_id,
          'minutes_over', v_minutes_over
        )
      )
    )
    ON CONFLICT (dedup_key) DO NOTHING;
  END LOOP;
END;
$function$;
