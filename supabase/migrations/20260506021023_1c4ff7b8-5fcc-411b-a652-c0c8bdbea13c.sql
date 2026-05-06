CREATE OR REPLACE FUNCTION public.send_hourly_sales_pulse()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
      COALESCE(
        NULLIF(sc.override_projection, 0),
        NULLIF(sc.living_projection, 0),
        NULLIF(sc.initial_projection, 0),
        NULLIF(sc.projected_sales, 0),
        0
      ),
      COALESCE(sc.net_sales, 0),
      sc.hourly_data
    INTO v_goal, v_net_sales, v_hourly_data
    FROM sales_cache sc
    WHERE sc.location_id = loc.id AND sc.sale_date = local_date::DATE
    LIMIT 1;

    IF v_goal IS NULL OR v_goal = 0 THEN CONTINUE; END IF;
    IF v_net_sales < 100 THEN CONTINUE; END IF;

    v_pace_sum := 0;
    v_has_projections := false;

    IF v_hourly_data IS NOT NULL AND jsonb_typeof(v_hourly_data) = 'array' THEN
      FOR v_elem IN SELECT value FROM jsonb_array_elements(v_hourly_data) LOOP
        v_hour_num := COALESCE(LEFT(v_elem->>'hour', 2)::INTEGER, 0);
        v_actual := COALESCE((v_elem->>'sales')::NUMERIC, 0);
        v_projected := COALESCE((v_elem->>'projected')::NUMERIC, 0);
        IF v_projected > 0 THEN v_has_projections := true; END IF;
        IF v_hour_num < local_hours THEN
          v_pace_sum := v_pace_sum + v_actual;
        ELSIF v_hour_num = local_hours THEN
          IF local_minutes < 30 THEN
            v_pace_sum := v_pace_sum + GREATEST(v_projected, v_actual);
          ELSE
            v_remain_frac := (60.0 - local_minutes) / 60.0;
            v_pace_sum := v_pace_sum + v_actual + (v_projected * v_remain_frac);
          END IF;
        ELSE
          v_pace_sum := v_pace_sum + v_projected;
        END IF;
      END LOOP;
    END IF;

    IF v_has_projections AND v_pace_sum > 0 THEN
      v_pace := GREATEST(v_pace_sum, v_net_sales);
    ELSE
      v_pace := GREATEST(v_goal, v_net_sales);
    END IF;

    v_pace_pct := CASE WHEN v_goal > 0 THEN (v_pace / v_goal) * 100 ELSE 0 END;

    IF v_pace_pct >= 110 THEN v_status := '🔥 On fire';
    ELSIF v_pace_pct >= 100 THEN v_status := '✅ Ahead of pace';
    ELSIF v_pace_pct >= 95 THEN v_status := '➡️ On pace';
    ELSE v_status := '⚠️ Behind pace';
    END IF;

    SELECT lc.labor_cost, 
           CASE WHEN v_net_sales > 0 THEN (lc.labor_cost / v_net_sales) * 100 ELSE NULL END
    INTO v_labor_cost, v_labor_pct
    FROM labor_cache lc
    WHERE lc.location_id = loc.id AND lc.labor_date = local_date::DATE
    ORDER BY CASE WHEN lc.source = 'punch_clock' THEN 0 ELSE 1 END
    LIMIT 1;

    v_dedup_key := 'hourly_pulse_' || loc.id::TEXT || '_' || local_date || '_' || local_hours::TEXT;

    IF EXISTS (SELECT 1 FROM alert_queue WHERE dedup_key = v_dedup_key) THEN
      CONTINUE;
    END IF;

    v_body := loc.name || ' • ' || v_status || E'\n' ||
              'Sales: $' || to_char(v_net_sales, 'FM999,999,990.00') ||
              ' / Goal: $' || to_char(v_goal, 'FM999,999,990.00') || E'\n' ||
              'Pace: $' || to_char(v_pace, 'FM999,999,990.00') || ' (' || to_char(v_pace_pct, 'FM990.0') || '%)';

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
        SELECT 1 FROM role_notification_settings rns
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