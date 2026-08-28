CREATE OR REPLACE FUNCTION public.check_alerts_sql()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  loc RECORD;
  tz TEXT;
  local_date TEXT;
  local_day INTEGER;
  current_total_minutes INTEGER;
  local_hours INTEGER;
  local_minutes INTEGER;
  local_year INTEGER;
  local_month INTEGER;
  local_day_of_month INTEGER;
  start_of_day_utc TIMESTAMPTZ;
  end_of_day_utc TIMESTAMPTZ;
  v_dedup_key TEXT;

  business_local_day_mon0 INTEGER;
  today_close TIME;
  close_hour INTEGER;
  cutoff_hour INTEGER;
  is_overnight BOOLEAN;
  start_hour_local INTEGER;
  business_date DATE;
  business_date_str TEXT;
  business_start_utc TIMESTAMPTZ;
  business_end_utc TIMESTAMPTZ;
BEGIN
  FOR loc IN
    SELECT l.id, l.name, COALESCE(ls.timezone, 'America/Los_Angeles') AS timezone
    FROM locations l
    LEFT JOIN LATERAL (
      SELECT timezone FROM location_settings WHERE location_id = l.id LIMIT 1
    ) ls ON true
  LOOP
    tz := loc.timezone;
    local_hours := EXTRACT(HOUR FROM now() AT TIME ZONE tz)::INTEGER;
    local_minutes := EXTRACT(MINUTE FROM now() AT TIME ZONE tz)::INTEGER;
    current_total_minutes := local_hours * 60 + local_minutes;
    local_day := EXTRACT(DOW FROM now() AT TIME ZONE tz)::INTEGER;
    local_date := to_char(now() AT TIME ZONE tz, 'YYYY-MM-DD');
    local_year := EXTRACT(YEAR FROM now() AT TIME ZONE tz)::INTEGER;
    local_month := EXTRACT(MONTH FROM now() AT TIME ZONE tz)::INTEGER;
    local_day_of_month := EXTRACT(DAY FROM now() AT TIME ZONE tz)::INTEGER;
    start_of_day_utc := (local_date || 'T00:00:00')::TIMESTAMP AT TIME ZONE tz;
    end_of_day_utc := (local_date || 'T23:59:59')::TIMESTAMP AT TIME ZONE tz;

    business_local_day_mon0 := (local_day + 6) % 7;
    SELECT close_time INTO today_close
    FROM location_hours
    WHERE location_id = loc.id
      AND day_of_week = business_local_day_mon0
    LIMIT 1;

    close_hour := COALESCE(EXTRACT(HOUR FROM today_close)::INTEGER, -1);
    cutoff_hour := CASE WHEN close_hour >= 0 THEN (close_hour + 3) % 24 ELSE 3 END;
    is_overnight := cutoff_hour > 0 AND cutoff_hour < 12;
    start_hour_local := CASE WHEN is_overnight THEN cutoff_hour ELSE 0 END;

    IF is_overnight AND local_hours < cutoff_hour THEN
      business_date := local_date::DATE - 1;
    ELSE
      business_date := local_date::DATE;
    END IF;
    business_date_str := to_char(business_date, 'YYYY-MM-DD');

    business_start_utc := (business_date_str || 'T' || lpad(start_hour_local::TEXT, 2, '0') || ':00:00')::TIMESTAMP AT TIME ZONE tz;
    business_end_utc   := ((business_date + 1)::TEXT || 'T' || lpad(start_hour_local::TEXT, 2, '0') || ':00:00')::TIMESTAMP AT TIME ZONE tz;

    -- ==================== OVERDUE CHECKLISTS ====================
    DECLARE
      cl RECORD;
      due_total_minutes INTEGER;
      total_items INTEGER;
      completed_items INTEGER;
      remaining_tasks INTEGER;
      v_body TEXT;
      v_family UUID;
      admin_user_ids UUID[];
    BEGIN
      FOR cl IN
        SELECT c.id, c.title, c.due_by_time, c.frequency, c.template_type, COALESCE(c.family_id, c.id) AS family_id
        FROM checklists c
        WHERE c.is_active = true
          AND c.superseded_at IS NULL
          AND c.location_id = loc.id
          AND c.due_by_time IS NOT NULL
          AND (c.frequency = 'daily' OR c.template_type = 'dynamic')
      LOOP
        v_family := cl.family_id;
        due_total_minutes := EXTRACT(HOUR FROM cl.due_by_time::TIME)::INTEGER * 60 
                           + EXTRACT(MINUTE FROM cl.due_by_time::TIME)::INTEGER;
        IF current_total_minutes < due_total_minutes THEN CONTINUE; END IF;
        IF current_total_minutes > due_total_minutes + 180 THEN CONTINUE; END IF;

        WITH base AS (
          SELECT
            ci.id,
            ci.item_type,
            ci.order_index,
            ci.days_of_week,
            (
              SELECT MAX(ci2.order_index)
              FROM checklist_items ci2
              WHERE ci2.checklist_id = ci.checklist_id
                AND ci2.item_type = 'section_header'
                AND ci2.order_index <= ci.order_index AND ci2.deleted_at IS NULL
            ) AS section_anchor
          FROM checklist_items ci
          WHERE ci.checklist_id = cl.id AND ci.deleted_at IS NULL
        ),
        scoped AS (
          SELECT * FROM base
          WHERE
            item_type = 'section_header'
            OR cl.template_type <> 'dynamic'
            OR (days_of_week IS NOT NULL AND business_local_day_mon0 = ANY(days_of_week))
        ),
        answered_items AS (
          SELECT DISTINCT cr.item_id
          FROM checklist_submissions cs
          JOIN checklist_responses cr ON cr.submission_id = cs.id
            JOIN checklist_items ci_live ON ci_live.id = cr.item_id AND ci_live.deleted_at IS NULL
          WHERE cs.checklist_id = cl.id
            AND cs.location_id = loc.id
            AND cs.submitted_at >= business_start_utc
            AND cs.submitted_at <  business_end_utc
        ),
        completed_sections AS (
          SELECT DISTINCT s.section_anchor
          FROM scoped s
          WHERE s.item_type <> 'section_header'
            AND s.section_anchor IS NOT NULL
            AND s.id IN (SELECT item_id FROM answered_items)
        )
        SELECT
          COUNT(*),
          COUNT(*) FILTER (
            WHERE item_type <> 'section_header'
              AND id IN (SELECT item_id FROM answered_items)
          )
          + COUNT(*) FILTER (
            WHERE item_type = 'section_header'
              AND order_index IN (SELECT section_anchor FROM completed_sections)
          )
        INTO total_items, completed_items
        FROM scoped;

        IF total_items IS NULL OR total_items = 0 THEN CONTINUE; END IF;
        remaining_tasks := GREATEST(0, total_items - COALESCE(completed_items, 0));
        IF remaining_tasks <= 0 THEN CONTINUE; END IF;

        -- Dedup on the FAMILY, not the version id, so a swap this morning does not
        -- fire a second ping for the same list.
        v_dedup_key := 'overdue_' || v_family || '_' || business_date_str || '_h' || local_hours::TEXT;
        IF EXISTS (
          SELECT 1 FROM checklist_notification_logs cnl
          JOIN checklists c2 ON c2.id = cnl.checklist_id
          WHERE COALESCE(c2.family_id, c2.id) = v_family
            AND cnl.location_id = loc.id
            AND cnl.notification_type = 'overdue_hourly'
            AND cnl.sent_at >= now() - INTERVAL '59 minutes'
        ) THEN
          CONTINUE;
        END IF;
        IF COALESCE(completed_items, 0) = 0 THEN
          v_body := cl.title || ' is not started';
        ELSE
          v_body := cl.title || ' not completed, ' || remaining_tasks || ' task' || 
                    CASE WHEN remaining_tasks = 1 THEN '' ELSE 's' END || ' remaining';
        END IF;
        SELECT ARRAY_AGG(ur.user_id) INTO admin_user_ids
        FROM user_locations ul
        JOIN user_roles ur ON ur.user_id = ul.user_id
        WHERE ul.location_id = loc.id
          AND ur.role IN ('super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager')
          AND NOT EXISTS (
            SELECT 1 FROM user_notification_settings uns
            WHERE uns.user_id = ur.user_id
              AND uns.location_id = loc.id
              AND uns.notification_type = 'overdue_checklists'
              AND uns.push_enabled = false
          );
        IF admin_user_ids IS NULL OR array_length(admin_user_ids, 1) IS NULL THEN
          CONTINUE;
        END IF;
        INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
        VALUES (
          'overdue_checklist',
          v_dedup_key,
          loc.id,
          jsonb_build_object(
            'user_ids', to_jsonb(admin_user_ids),
            'title', 'Overdue Checklist - ' || loc.name,
            'body', v_body,
            'notification_type', 'overdue_checklists',
            'data', jsonb_build_object('checklist_id', cl.id, 'type', 'overdue_checklist', 'location_id', loc.id)
          )
        )
        ON CONFLICT (dedup_key) DO NOTHING;
        INSERT INTO checklist_notification_logs (checklist_id, location_id, notification_type)
        VALUES (cl.id, loc.id, 'overdue_hourly');
      END LOOP;
    END;

    -- ==================== LATE ARRIVALS ====================
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
      IF late_admin_ids IS NOT NULL AND array_length(late_admin_ids, 1) > 0 THEN
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
            WHERE tp.user_id = shift.user_id
              AND tp.punch_type = 'clock_in'
              AND tp.location_id = loc.id
              AND tp.punch_time >= start_of_day_utc
              AND tp.punch_time <= end_of_day_utc
          ) INTO has_punch;
          IF has_punch THEN CONTINUE; END IF;

          v_dedup_key := 'late_' || shift.id || '_' || local_date;
          INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
          VALUES (
            'late_arrival',
            v_dedup_key,
            loc.id,
            jsonb_build_object(
              'user_ids', to_jsonb(late_admin_ids),
              'title', 'Late Arrival - ' || loc.name,
              'body', shift.full_name || ' has not clocked in (scheduled ' || to_char(shift.start_time::TIME, 'HH12:MI AM') || ')',
              'notification_type', 'late_arrivals',
              'data', jsonb_build_object('shift_id', shift.id, 'user_id', shift.user_id, 'type', 'late_arrival', 'location_id', loc.id)
            )
          )
          ON CONFLICT (dedup_key) DO NOTHING;
        END LOOP;
      END IF;
    END;

    -- ==================== MONTHLY CHECKLISTS ====================
    DECLARE
      mcl RECORD;
      mc_total_items INTEGER;
      mc_completed INTEGER;
      mc_remaining INTEGER;
      mc_user_ids UUID[];
      mc_start_of_month TIMESTAMPTZ;
      last_day_of_month DATE;
      days_until_month_end INTEGER;
      urgency_text TEXT;
    BEGIN
      last_day_of_month := (date_trunc('month', local_date::DATE) + INTERVAL '1 month - 1 day')::DATE;
      days_until_month_end := last_day_of_month - local_date::DATE;
      mc_start_of_month := (to_char(date_trunc('month', local_date::DATE), 'YYYY-MM-DD') || 'T00:00:00')::TIMESTAMP AT TIME ZONE tz;

      FOR mcl IN
        SELECT c.id, c.title, c.visible_days_before_month_end
        FROM checklists c
        WHERE c.is_active = true
          AND c.superseded_at IS NULL
          AND c.location_id = loc.id
          AND c.frequency = 'monthly'
      LOOP
        IF days_until_month_end > COALESCE(mcl.visible_days_before_month_end, 5) THEN CONTINUE; END IF;
        IF days_until_month_end > 3 THEN CONTINUE; END IF;

        WITH base AS (
          SELECT
            ci.id, ci.item_type, ci.order_index,
            (
              SELECT MAX(ci2.order_index)
              FROM checklist_items ci2
              WHERE ci2.checklist_id = ci.checklist_id
                AND ci2.item_type = 'section_header'
                AND ci2.order_index <= ci.order_index AND ci2.deleted_at IS NULL
            ) AS section_anchor
          FROM checklist_items ci
          WHERE ci.checklist_id = mcl.id AND ci.deleted_at IS NULL
        ),
        answered_items AS (
          SELECT DISTINCT cr.item_id
          FROM checklist_submissions cs
          JOIN checklist_responses cr ON cr.submission_id = cs.id
            JOIN checklist_items ci_live ON ci_live.id = cr.item_id AND ci_live.deleted_at IS NULL
          WHERE cs.checklist_id = mcl.id
            AND cs.location_id = loc.id
            AND cs.submitted_at >= mc_start_of_month
        ),
        completed_sections AS (
          SELECT DISTINCT b.section_anchor
          FROM base b
          WHERE b.item_type <> 'section_header'
            AND b.section_anchor IS NOT NULL
            AND b.id IN (SELECT item_id FROM answered_items)
        )
        SELECT
          COUNT(*),
          COUNT(*) FILTER (
            WHERE item_type <> 'section_header'
              AND id IN (SELECT item_id FROM answered_items)
          )
          + COUNT(*) FILTER (
            WHERE item_type = 'section_header'
              AND order_index IN (SELECT section_anchor FROM completed_sections)
          )
        INTO mc_total_items, mc_completed
        FROM base;

        IF mc_total_items IS NULL OR mc_total_items = 0 THEN CONTINUE; END IF;
        mc_remaining := GREATEST(0, mc_total_items - COALESCE(mc_completed, 0));
        IF mc_remaining <= 0 THEN CONTINUE; END IF;
        IF days_until_month_end = 0 THEN
          urgency_text := '🔴 LAST DAY: ';
        ELSIF days_until_month_end = 1 THEN
          urgency_text := '🟡 Due Tomorrow: ';
        ELSE
          urgency_text := '📋 Due in ' || days_until_month_end || ' days: ';
        END IF;
        v_dedup_key := 'monthly_' || mcl.id || '_' || local_date;
        IF current_total_minutes < 540 OR current_total_minutes >= 560 THEN CONTINUE; END IF;
        SELECT ARRAY_AGG(ur.user_id) INTO mc_user_ids
        FROM user_locations ul
        JOIN user_roles ur ON ur.user_id = ul.user_id
        WHERE ul.location_id = loc.id
          AND ur.role IN ('super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager')
          AND NOT EXISTS (
            SELECT 1 FROM user_notification_settings uns
            WHERE uns.user_id = ur.user_id
              AND uns.location_id = loc.id
              AND uns.notification_type = 'overdue_checklists'
              AND uns.push_enabled = false
          );
        IF mc_user_ids IS NULL OR array_length(mc_user_ids, 1) IS NULL THEN CONTINUE; END IF;
        INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
        VALUES (
          'monthly_checklist',
          v_dedup_key,
          loc.id,
          jsonb_build_object(
            'user_ids', to_jsonb(mc_user_ids),
            'title', urgency_text || mcl.title,
            'body', mc_remaining || ' task' || CASE WHEN mc_remaining = 1 THEN '' ELSE 's' END || ' remaining for ' || to_char(now() AT TIME ZONE tz, 'Month'),
            'notification_type', 'overdue_checklists',
            'data', jsonb_build_object('checklist_id', mcl.id, 'type', 'monthly_checklist', 'location_id', loc.id)
          )
        )
        ON CONFLICT (dedup_key) DO NOTHING;
      END LOOP;
    END;

    -- ==================== CERTIFICATE EXPIRY ====================
    DECLARE
      cert RECORD;
      cert_user_ids UUID[];
      days_until_expiry INTEGER;
      cert_urgency TEXT;
    BEGIN
      FOR cert IN
        SELECT c.id, c.user_id, c.certification_type, c.expiration_date, p.full_name
        FROM certifications c
        JOIN profiles p ON p.id = c.user_id
        JOIN user_locations ul ON ul.user_id = c.user_id AND ul.location_id = loc.id
        WHERE c.expiration_date BETWEEN local_date::DATE AND (local_date::DATE + INTERVAL '30 days')
          AND c.status != 'expired'
      LOOP
        days_until_expiry := (cert.expiration_date::DATE - local_date::DATE);
        IF days_until_expiry NOT IN (0, 1, 3, 7, 14, 30) THEN CONTINUE; END IF;
        IF current_total_minutes < 540 OR current_total_minutes >= 560 THEN CONTINUE; END IF;
        IF days_until_expiry = 0 THEN
          cert_urgency := '🔴 EXPIRED TODAY: ';
        ELSIF days_until_expiry = 1 THEN
          cert_urgency := '🟡 Expires Tomorrow: ';
        ELSE
          cert_urgency := '📋 Expires in ' || days_until_expiry || ' days: ';
        END IF;
        v_dedup_key := 'cert_' || cert.id || '_' || local_date;
        SELECT ARRAY_AGG(ur.user_id) INTO cert_user_ids
        FROM user_locations ul2
        JOIN user_roles ur ON ur.user_id = ul2.user_id
        WHERE ul2.location_id = loc.id
          AND ur.role IN ('super_admin', 'org_admin', 'admin', 'manager', 'general_manager');
        IF cert_user_ids IS NULL OR array_length(cert_user_ids, 1) IS NULL THEN CONTINUE; END IF;
        INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
        VALUES (
          'certificate_expiry',
          v_dedup_key,
          loc.id,
          jsonb_build_object(
            'user_ids', to_jsonb(cert_user_ids),
            'title', cert_urgency || cert.certification_type,
            'body', cert.full_name || '''s ' || cert.certification_type || ' expires ' || 
                    CASE WHEN days_until_expiry = 0 THEN 'today' WHEN days_until_expiry = 1 THEN 'tomorrow' ELSE 'in ' || days_until_expiry || ' days' END,
            'notification_type', 'certificate_expiry',
            'data', jsonb_build_object('cert_id', cert.id, 'user_id', cert.user_id, 'type', 'certificate_expiry', 'location_id', loc.id)
          )
        )
        ON CONFLICT (dedup_key) DO NOTHING;
      END LOOP;
    END;

  END LOOP;
END;
$function$;