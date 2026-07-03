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

    SELECT COALESCE(NULLIF(TRIM(p.full_name), ''), 'Team member')
    INTO v_user_name FROM profiles p WHERE p.id = rec.user_id;

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
      'shift_overstay',
      v_dedup_key,
      rec.location_id,
      jsonb_build_object(
        'user_ids', v_user_ids,
        'title', 'Shift overstay',
        'body', v_user_name || ' is still clocked in ' || v_minutes_over || ' min past end of shift at ' || rec.location_name,
        'notification_type', 'shift_overstay',
        'data', jsonb_build_object('punch_id', rec.punch_id, 'user_id', rec.user_id, 'minutes_over', v_minutes_over)
      )
    );
  END LOOP;
END;
$function$;