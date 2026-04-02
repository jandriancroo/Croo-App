CREATE OR REPLACE FUNCTION public.send_hourly_sales_pulse()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    IF is_open IS NULL OR is_open = false THEN
      CONTINUE;
    END IF;

    -- Skip if outside operating hours
    IF local_hours < open_hour OR local_hours > close_hour THEN
      CONTINUE;
    END IF;

    -- Skip the first hour after open — no meaningful data yet
    IF local_hours <= open_hour THEN
      CONTINUE;
    END IF;

    -- Read goal and pace directly from sales_cache
    SELECT 
      COALESCE(sc.override_projection, sc.initial_projection, sc.projected_sales, 0),
      COALESCE(sc.net_sales, 0),
      COALESCE(sc.living_projection, sc.override_projection, sc.initial_projection, sc.projected_sales, 0)
    INTO v_goal, v_net_sales, v_pace
    FROM sales_cache sc
    WHERE sc.location_id = loc.id AND sc.sale_date = local_date::DATE
    LIMIT 1;

    IF v_goal IS NULL OR v_goal = 0 THEN
      CONTINUE;
    END IF;

    -- Skip if no sales recorded yet (store just opened, POS hasn't synced)
    IF v_net_sales < 100 THEN
      CONTINUE;
    END IF;

    -- Guardrail: pace should never be below actual sales
    IF v_pace < v_net_sales THEN
      v_pace := v_net_sales;
    END IF;

    -- Labor
    SELECT COALESCE(lc.labor_cost, 0) INTO v_labor_cost
    FROM labor_cache lc
    WHERE lc.location_id = loc.id 
      AND lc.labor_date = local_date::DATE
    ORDER BY CASE WHEN lc.source = 'punch_clock' THEN 0 ELSE 1 END
    LIMIT 1;

    v_labor_cost := COALESCE(v_labor_cost, 0);

    IF v_net_sales > 0 THEN
      v_labor_pct := ROUND((v_labor_cost / v_net_sales) * 100, 1);
    ELSE
      v_labor_pct := 0;
    END IF;

    v_body := 'Goal: $' || to_char(v_goal, 'FM999,999') ||
              ' | Pace: $' || to_char(v_pace, 'FM999,999') ||
              ' | Labor: ' || v_labor_pct || '%';

    SELECT ARRAY_AGG(DISTINCT ul.user_id) INTO v_user_ids
    FROM user_locations ul
    JOIN user_roles ur ON ur.user_id = ul.user_id
    WHERE ul.location_id = loc.id
      AND ur.role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'manager')
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

    v_dedup_key := 'sales_pulse_' || loc.id || '_' || local_date || '_h' || local_hours::TEXT;

    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES (
      'hourly_sales_pulse',
      v_dedup_key,
      loc.id,
      jsonb_build_object(
        'user_ids', to_jsonb(v_user_ids),
        'title', '📊 ' || loc.name || ' - Hourly Update',
        'body', v_body,
        'notification_type', 'hourly_sales_pulse',
        'data', jsonb_build_object('type', 'hourly_sales_pulse', 'location_id', loc.id)
      )
    )
    ON CONFLICT (dedup_key) DO NOTHING;

    RAISE LOG '[sales-pulse-v3] Queued for % (%): %', loc.name, loc.id, v_body;
  END LOOP;
END;
$$;