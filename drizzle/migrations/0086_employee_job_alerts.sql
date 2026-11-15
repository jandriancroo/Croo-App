ALTER TABLE public.location_settings ADD COLUMN IF NOT EXISTS ncns_alert_minutes integer DEFAULT 30;
COMMENT ON COLUMN public.location_settings.ncns_alert_minutes IS 'No-call/no-show alert delay in minutes; 0 disables, NULL uses 30.';
DO $migration$
DECLARE definition text; a integer; b integer;
BEGIN
 SELECT pg_get_functiondef('public.check_alerts_sql()'::regprocedure) INTO definition;
 a := strpos(definition, '    -- ==================== LATE ARRIVALS');
 b := strpos(definition, '    -- ==================== MONTHLY CHECKLISTS');
 IF a = 0 OR b <= a THEN RAISE EXCEPTION 'Expected late-arrival block missing'; END IF;
 definition := substr(definition, 1, a - 1) || $late$    -- ==================== LATE ARRIVALS ====================
    DECLARE
      shift RECORD;
      shift_start_minutes INTEGER;
      minutes_since_start INTEGER;
      has_punch BOOLEAN;
      late_admin_ids UUID[];
    BEGIN
      SELECT ARRAY_AGG(ur.user_id) INTO late_admin_ids
      FROM user_locations ul
      JOIN user_roles ur ON ur.user_id = ul.user_id
      WHERE ul.location_id = loc.id
        AND ur.role IN ('super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager')
        AND NOT EXISTS (
          SELECT 1 FROM user_notification_settings uns
          WHERE uns.user_id = ur.user_id
            AND uns.location_id = loc.id
            AND uns.notification_type = 'late_arrivals'
            AND uns.push_enabled = false
        );
      FOR shift IN
        SELECT ss.id, ss.user_id, ss.start_time, p.full_name
        FROM scheduled_shifts ss
        JOIN schedules s ON s.id = ss.schedule_id
        JOIN profiles p ON p.id = ss.user_id
        WHERE s.location_id = loc.id
          AND ss.shift_date = local_date::DATE
          AND ss.user_id IS NOT NULL
          AND s.week_start_date <= local_date::DATE
          AND s.week_end_date >= local_date::DATE
          AND s.is_published = true
      LOOP
        shift_start_minutes := EXTRACT(HOUR FROM shift.start_time::TIME)::INTEGER * 60
          + EXTRACT(MINUTE FROM shift.start_time::TIME)::INTEGER;
        minutes_since_start := current_total_minutes - shift_start_minutes;
        IF minutes_since_start < 15 OR minutes_since_start >= 20 THEN CONTINUE; END IF;
        SELECT EXISTS (
          SELECT 1 FROM time_punches tp
          WHERE tp.user_id = shift.user_id AND tp.punch_type = 'clock_in' AND tp.location_id = loc.id
            AND tp.punch_time >= start_of_day_utc AND tp.punch_time <= end_of_day_utc
        ) INTO has_punch;
        IF has_punch THEN CONTINUE; END IF;
        IF late_admin_ids IS NOT NULL AND array_length(late_admin_ids, 1) > 0 THEN
          v_dedup_key := 'late_' || shift.id || '_' || local_date;
          INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
          VALUES ('late_arrival', v_dedup_key, loc.id,
            jsonb_build_object('user_ids', to_jsonb(late_admin_ids), 'title', 'Late Arrival - ' || loc.name,
              'body', shift.full_name || ' has not clocked in (scheduled ' || to_char(shift.start_time::TIME, 'HH12:MI AM') || ')',
              'notification_type', 'late_arrivals',
              'data', jsonb_build_object('shift_id', shift.id, 'user_id', shift.user_id, 'type', 'late_arrival', 'location_id', loc.id)))
          ON CONFLICT (dedup_key) DO NOTHING;
        END IF;
        INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
        VALUES ('late_arrival_self', 'late_self_' || shift.id || '_' || local_date, loc.id,
          jsonb_build_object('user_ids', jsonb_build_array(shift.user_id), 'title', 'You have not clocked in',
            'body', 'You were scheduled at ' || to_char(shift.start_time::TIME, 'HH12:MI AM') || ' at ' || loc.name || '. You haven''t clocked in yet. If you''re running late, let your manager know.',
            'notification_type', 'late_arrival_self', 'data', jsonb_build_object('shift_id', shift.id, 'url', 'https://croohq.com/schedule')))
        ON CONFLICT (dedup_key) DO NOTHING;
      END LOOP;
    END;
    -- ==================== NO CALL / NO SHOW (read-only clock checks) ====================
    DECLARE
      shift RECORD;
      ncns_minutes INTEGER;
      minutes_since_start NUMERIC;
      ncns_admin_ids UUID[];
    BEGIN
      SELECT COALESCE(ls.ncns_alert_minutes, 30) INTO ncns_minutes FROM location_settings ls WHERE ls.location_id = loc.id LIMIT 1;
      ncns_minutes := COALESCE(ncns_minutes, 30);
      IF ncns_minutes > 0 THEN
        SELECT ARRAY_AGG(DISTINCT ur.user_id) INTO ncns_admin_ids
        FROM user_locations ul JOIN user_roles ur ON ur.user_id = ul.user_id
        WHERE ul.location_id = loc.id AND ur.role IN ('super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager');
        FOR shift IN
          SELECT ss.id, ss.user_id, ss.start_time, p.full_name
          FROM scheduled_shifts ss JOIN schedules s ON s.id = ss.schedule_id JOIN profiles p ON p.id = ss.user_id
          WHERE s.location_id = loc.id AND ss.shift_date = local_date::DATE AND ss.user_id IS NOT NULL
            AND s.week_start_date <= local_date::DATE AND s.week_end_date >= local_date::DATE AND s.is_published = true
            AND NOT COALESCE(ss.is_time_off, false) AND NOT COALESCE(ss.is_phantom, false) AND NOT COALESCE(ss.is_coverage_only, false)
        LOOP
          minutes_since_start := EXTRACT(EPOCH FROM (now() - ((local_date::DATE + shift.start_time::TIME) AT TIME ZONE tz))) / 60;
          IF minutes_since_start < ncns_minutes OR minutes_since_start >= ncns_minutes + 5 THEN CONTINUE; END IF;
          IF EXISTS (SELECT 1 FROM time_punches tp WHERE tp.user_id = shift.user_id AND tp.location_id = loc.id
            AND tp.punch_type = 'clock_in' AND tp.punch_time >= start_of_day_utc AND tp.punch_time <= end_of_day_utc)
            OR EXISTS (SELECT 1 FROM toast_shifts ts WHERE ts.croo_user_id = shift.user_id AND ts.location_id = loc.id
              AND ts.shift_date = local_date::DATE AND ts.in_time IS NOT NULL) THEN CONTINUE; END IF;
          IF COALESCE(array_length(ncns_admin_ids, 1), 0) > 0 THEN
            INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
            VALUES ('no_call_no_show', 'ncns_' || shift.id || '_' || local_date, loc.id,
              jsonb_build_object('user_ids', to_jsonb(ncns_admin_ids), 'title', 'No-call/no-show - ' || loc.name,
                'body', 'No-call/no-show: ' || shift.full_name || ' was scheduled at ' || to_char(shift.start_time::TIME, 'HH12:MI AM') || ' and hasn''t clocked in (' || ncns_minutes || ' min).',
                'notification_type', 'no_call_no_show', 'data', jsonb_build_object('shift_id', shift.id, 'url', 'https://croohq.com/schedule')))
            ON CONFLICT (dedup_key) DO NOTHING;
          END IF;
          INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
          VALUES ('no_call_no_show_self', 'ncns_self_' || shift.id || '_' || local_date, loc.id,
            jsonb_build_object('user_ids', jsonb_build_array(shift.user_id), 'title', 'Please contact your manager',
              'body', 'You were scheduled at ' || to_char(shift.start_time::TIME, 'HH12:MI AM') || ' at ' || loc.name || ' and haven''t clocked in. Please contact your manager now.',
              'notification_type', 'no_call_no_show_self', 'data', jsonb_build_object('shift_id', shift.id, 'url', 'https://croohq.com/schedule')))
          ON CONFLICT (dedup_key) DO NOTHING;
        END LOOP;
      END IF;
    END;
$late$ || substr(definition, b);
 a := strpos(definition, '    -- ==================== CERTIFICATE EXPIRY');
 b := strpos(definition, E'\n  END LOOP;\nEND;');
 IF a = 0 OR b <= a THEN RAISE EXCEPTION 'Expected certificate block missing'; END IF;
 definition := substr(definition, 1, a - 1) || $cert$    -- ==================== CERTIFICATE EXPIRY ====================
    DECLARE
      cert RECORD;
      cert_user_ids UUID[];
      days_until_expiry INTEGER;
      cert_urgency TEXT;
    BEGIN
      FOR cert IN
        SELECT c.id, c.user_id, c.certification_type, c.expiration_date, p.full_name
        FROM certifications c JOIN profiles p ON p.id = c.user_id
        JOIN user_locations ul ON ul.user_id = c.user_id AND ul.location_id = loc.id
        WHERE c.expiration_date BETWEEN local_date::DATE AND (local_date::DATE + INTERVAL '30 days') AND c.status != 'expired'
      LOOP
        days_until_expiry := (cert.expiration_date::DATE - local_date::DATE);
        IF days_until_expiry NOT IN (0, 1, 3, 7, 14, 30) THEN CONTINUE; END IF;
        IF current_total_minutes < 540 OR current_total_minutes >= 560 THEN CONTINUE; END IF;
        IF days_until_expiry = 0 THEN cert_urgency := '🔴 EXPIRED TODAY: ';
        ELSIF days_until_expiry = 1 THEN cert_urgency := '🟡 Expires Tomorrow: ';
        ELSE cert_urgency := '📋 Expires in ' || days_until_expiry || ' days: '; END IF;
        v_dedup_key := 'cert_' || cert.id || '_' || local_date;
        SELECT ARRAY_AGG(ur.user_id) INTO cert_user_ids FROM user_locations ul2 JOIN user_roles ur ON ur.user_id = ul2.user_id
        WHERE ul2.location_id = loc.id AND ur.role IN ('super_admin', 'org_admin', 'admin', 'manager', 'general_manager');
        IF cert_user_ids IS NOT NULL AND array_length(cert_user_ids, 1) > 0 THEN
          INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
          VALUES ('certificate_expiry', v_dedup_key, loc.id,
            jsonb_build_object('user_ids', to_jsonb(cert_user_ids), 'title', cert_urgency || cert.certification_type,
              'body', cert.full_name || '''s ' || cert.certification_type || ' expires ' || CASE WHEN days_until_expiry = 0 THEN 'today' WHEN days_until_expiry = 1 THEN 'tomorrow' ELSE 'in ' || days_until_expiry || ' days' END,
              'notification_type', 'certificate_expiry', 'data', jsonb_build_object('cert_id', cert.id, 'user_id', cert.user_id, 'type', 'certificate_expiry', 'location_id', loc.id)))
          ON CONFLICT (dedup_key) DO NOTHING;
        END IF;
        INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
        VALUES ('cert_expiring_self', 'cert_self_' || cert.id || '_' || local_date, loc.id,
          jsonb_build_object('user_ids', jsonb_build_array(cert.user_id), 'title', 'Your certification expires soon',
            'body', 'Your ' || cert.certification_type || ' expires ' || CASE WHEN days_until_expiry = 0 THEN 'today' WHEN days_until_expiry = 1 THEN 'tomorrow' ELSE 'in ' || days_until_expiry || ' days' END || '. Upload your new card in CrooHQ so you stay on the schedule.',
            'notification_type', 'cert_expiring_self', 'data', jsonb_build_object('cert_id', cert.id, 'url', 'https://croohq.com/certifications')))
        ON CONFLICT (dedup_key) DO NOTHING;
      END LOOP;
    END;
    -- ==================== READ & SIGN (new assignments only) ====================
    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    SELECT 'read_and_sign', 'rs_' || a.id, loc.id,
      jsonb_build_object('user_ids', jsonb_build_array(a.employee_id), 'title', 'New document to read & sign',
        'body', 'New document to read & sign: ' || doc.title || '.', 'notification_type', 'read_and_sign',
        'data', jsonb_build_object('assignment_id', a.id, 'url', 'https://croohq.com/dashboard'))
    FROM read_and_sign_assignments a JOIN read_and_sign_documents doc ON doc.id = a.document_id
    WHERE doc.location_id = loc.id AND doc.is_active AND a.signed_at IS NULL
      AND COALESCE(doc.scheduled_at, a.assigned_at) <= now()
      AND a.assigned_at >= TIMESTAMPTZ '2026-11-02 07:20:00+00'
    ON CONFLICT (dedup_key) DO NOTHING;
$cert$ || substr(definition, b);
 EXECUTE definition;
END;
$migration$;