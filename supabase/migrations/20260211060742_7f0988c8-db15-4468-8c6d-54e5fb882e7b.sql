
-- ============================================================
-- Unified alert_queue table — replaces alarm_trigger_queue
-- ============================================================

CREATE TABLE public.alert_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type TEXT NOT NULL,           -- 'alarm', 'overdue_checklist', 'monthly_checklist', 'late_arrival', 'clock_in_reminder', 'cert_expiry'
  dedup_key TEXT NOT NULL,            -- e.g. 'alarm_{task_id}_{date}_{time}', 'late_{shift_id}_{date}'
  location_id UUID REFERENCES public.locations(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { user_ids, title, body, notification_type, data }
  push_sent BOOLEAN NOT NULL DEFAULT false,
  push_sent_at TIMESTAMPTZ,
  push_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT alert_queue_dedup_key_unique UNIQUE (dedup_key)
);

-- Index for the push sender to poll efficiently
CREATE INDEX idx_alert_queue_pending ON public.alert_queue (push_sent, retry_count, created_at)
  WHERE push_sent = false AND retry_count < 3;

-- Index for cleanup queries
CREATE INDEX idx_alert_queue_created_at ON public.alert_queue (created_at);

-- Enable RLS
ALTER TABLE public.alert_queue ENABLE ROW LEVEL SECURITY;

-- Only service role should access this table (cron + edge functions)
-- No user-facing policies needed

-- ============================================================
-- Migrate existing alarm_trigger_queue data to alert_queue
-- ============================================================

INSERT INTO public.alert_queue (alert_type, dedup_key, location_id, payload, push_sent, push_sent_at, push_error, retry_count, created_at)
SELECT 
  'alarm',
  'alarm_' || task_id || '_' || interval_key,
  location_id,
  jsonb_build_object(
    'task_id', task_id,
    'interval_key', interval_key
  ),
  push_sent,
  push_sent_at,
  push_error,
  retry_count,
  created_at
FROM public.alarm_trigger_queue
ON CONFLICT (dedup_key) DO NOTHING;

-- ============================================================
-- Update trigger_alarm_tasks_sql to write to alert_queue
-- ============================================================

CREATE OR REPLACE FUNCTION public.trigger_alarm_tasks_sql()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  tz TEXT;
  day_of_week INTEGER;
  time_str TEXT;
  date_str TEXT;
  current_minute_of_day INTEGER;
  start_minutes INTEGER;
  end_minutes INTEGER;
  is_within_window BOOLEAN;
  should_trigger BOOLEAN;
  matched_time TEXT;
  boundary_minute INTEGER;
  last_boundary INTEGER;
  distance_to_last INTEGER;
  v_interval_key TEXT;
  v_dedup_key TEXT;
  min_gap_minutes INTEGER;
  minutes_since_last DOUBLE PRECISION;
BEGIN
  FOR rec IN
    SELECT 
      t.id,
      t.title,
      t.location_id,
      t.frequency_type,
      t.frequency_minutes,
      t.custom_times,
      t.alarm_start_time,
      t.alarm_end_time,
      t.days_of_week,
      t.last_triggered_at,
      COALESCE(ls.timezone, 'America/Los_Angeles') AS timezone
    FROM temporary_tasks t
    LEFT JOIN LATERAL (
      SELECT timezone FROM location_settings WHERE location_id = t.location_id LIMIT 1
    ) ls ON true
    WHERE t.task_style = 'alarm'
      AND t.is_active = true
      AND t.is_recurring = true
  LOOP
    tz := rec.timezone;

    SELECT 
      EXTRACT(DOW FROM now() AT TIME ZONE tz)::INTEGER,
      to_char(now() AT TIME ZONE tz, 'HH24:MI'),
      to_char(now() AT TIME ZONE tz, 'YYYY-MM-DD'),
      EXTRACT(HOUR FROM now() AT TIME ZONE tz)::INTEGER * 60 + EXTRACT(MINUTE FROM now() AT TIME ZONE tz)::INTEGER
    INTO day_of_week, time_str, date_str, current_minute_of_day;

    IF rec.days_of_week IS NULL OR NOT (day_of_week = ANY(rec.days_of_week)) THEN
      CONTINUE;
    END IF;

    start_minutes := EXTRACT(HOUR FROM rec.alarm_start_time)::INTEGER * 60 + EXTRACT(MINUTE FROM rec.alarm_start_time)::INTEGER;
    end_minutes := EXTRACT(HOUR FROM rec.alarm_end_time)::INTEGER * 60 + EXTRACT(MINUTE FROM rec.alarm_end_time)::INTEGER;

    IF start_minutes <= end_minutes THEN
      is_within_window := current_minute_of_day >= start_minutes AND current_minute_of_day <= end_minutes;
    ELSE
      is_within_window := current_minute_of_day >= start_minutes OR current_minute_of_day <= end_minutes;
    END IF;

    IF NOT is_within_window THEN
      CONTINUE;
    END IF;

    should_trigger := false;
    matched_time := NULL;

    IF rec.frequency_type = 'interval' AND rec.frequency_minutes IS NOT NULL THEN
      last_boundary := (current_minute_of_day / rec.frequency_minutes) * rec.frequency_minutes;
      distance_to_last := current_minute_of_day - last_boundary;

      IF distance_to_last <= 2 THEN
        boundary_minute := last_boundary;
      ELSIF (last_boundary + rec.frequency_minutes) - current_minute_of_day <= 2 THEN
        boundary_minute := last_boundary + rec.frequency_minutes;
      ELSE
        boundary_minute := NULL;
      END IF;

      IF boundary_minute IS NOT NULL THEN
        matched_time := lpad((boundary_minute / 60)::TEXT, 2, '0') || ':' || lpad((boundary_minute % 60)::TEXT, 2, '0');

        IF rec.last_triggered_at IS NOT NULL THEN
          minutes_since_last := EXTRACT(EPOCH FROM (now() - rec.last_triggered_at)) / 60.0;
          min_gap_minutes := rec.frequency_minutes - 2;
          IF minutes_since_last < min_gap_minutes THEN
            CONTINUE;
          END IF;
        END IF;

        should_trigger := true;
      END IF;

    ELSIF rec.frequency_type = 'custom' AND rec.custom_times IS NOT NULL THEN
      IF time_str = ANY(rec.custom_times) THEN
        should_trigger := true;
        matched_time := time_str;
      END IF;
    END IF;

    IF NOT should_trigger OR matched_time IS NULL THEN
      CONTINUE;
    END IF;

    v_interval_key := date_str || '_' || replace(matched_time, ':', '');
    v_dedup_key := 'alarm_' || rec.id || '_' || v_interval_key;

    -- Check if already completed for this interval
    IF EXISTS (
      SELECT 1 FROM alarm_task_completions 
      WHERE task_id = rec.id AND interval_key = v_interval_key
    ) THEN
      CONTINUE;
    END IF;

    -- Insert into unified alert_queue
    INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES (
      'alarm',
      v_dedup_key,
      rec.location_id,
      jsonb_build_object(
        'task_id', rec.id,
        'interval_key', v_interval_key
      )
    )
    ON CONFLICT (dedup_key) DO NOTHING;

    UPDATE temporary_tasks SET last_triggered_at = now() WHERE id = rec.id;

    RAISE LOG '[alarm-sql] Triggered task % (%): interval_key=%, local_time=%', rec.id, rec.title, v_interval_key, time_str;
  END LOOP;
END;
$function$;

-- ============================================================
-- NEW: check_alerts_sql — detects overdue checklists, late arrivals, cert expiry
-- Runs every 5 minutes via pg_cron
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_alerts_sql()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  loc RECORD;
  tz TEXT;
  local_now TIMESTAMPTZ;
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
BEGIN
  -- Process each location
  FOR loc IN
    SELECT l.id, l.name, COALESCE(ls.timezone, 'America/Los_Angeles') AS timezone
    FROM locations l
    LEFT JOIN LATERAL (
      SELECT timezone FROM location_settings WHERE location_id = l.id LIMIT 1
    ) ls ON true
  LOOP
    tz := loc.timezone;
    
    -- Calculate local time components
    local_hours := EXTRACT(HOUR FROM now() AT TIME ZONE tz)::INTEGER;
    local_minutes := EXTRACT(MINUTE FROM now() AT TIME ZONE tz)::INTEGER;
    current_total_minutes := local_hours * 60 + local_minutes;
    local_day := EXTRACT(DOW FROM now() AT TIME ZONE tz)::INTEGER;
    local_date := to_char(now() AT TIME ZONE tz, 'YYYY-MM-DD');
    local_year := EXTRACT(YEAR FROM now() AT TIME ZONE tz)::INTEGER;
    local_month := EXTRACT(MONTH FROM now() AT TIME ZONE tz)::INTEGER;
    local_day_of_month := EXTRACT(DAY FROM now() AT TIME ZONE tz)::INTEGER;
    
    -- Calculate day boundaries in UTC
    start_of_day_utc := (local_date || 'T00:00:00')::TIMESTAMP AT TIME ZONE tz;
    end_of_day_utc := (local_date || 'T23:59:59')::TIMESTAMP AT TIME ZONE tz;

    -- ==================== OVERDUE CHECKLISTS ====================
    DECLARE
      cl RECORD;
      due_total_minutes INTEGER;
      total_items INTEGER;
      completed_items INTEGER;
      remaining_tasks INTEGER;
      v_body TEXT;
      admin_user_ids UUID[];
    BEGIN
      FOR cl IN
        SELECT c.id, c.title, c.due_by_time, c.frequency, c.template_type
        FROM checklists c
        WHERE c.is_active = true
          AND c.location_id = loc.id
          AND c.due_by_time IS NOT NULL
          AND c.frequency IN ('daily', 'dynamic')
      LOOP
        -- Parse due time
        due_total_minutes := EXTRACT(HOUR FROM cl.due_by_time::TIME)::INTEGER * 60 
                           + EXTRACT(MINUTE FROM cl.due_by_time::TIME)::INTEGER;
        
        -- Skip if not yet due
        IF current_total_minutes < due_total_minutes THEN
          CONTINUE;
        END IF;

        -- Count total items relevant today
        IF cl.template_type = 'dynamic' THEN
          SELECT COUNT(*) INTO total_items
          FROM checklist_items ci
          WHERE ci.checklist_id = cl.id
            AND local_day = ANY(ci.days_of_week);
        ELSE
          SELECT COUNT(*) INTO total_items
          FROM checklist_items ci
          WHERE ci.checklist_id = cl.id;
        END IF;

        IF total_items = 0 THEN CONTINUE; END IF;

        -- Count completed items today
        SELECT COUNT(DISTINCT cr.item_id) INTO completed_items
        FROM checklist_submissions cs
        JOIN checklist_responses cr ON cr.submission_id = cs.id
        WHERE cs.checklist_id = cl.id
          AND cs.location_id = loc.id
          AND cs.submitted_at >= start_of_day_utc
          AND cs.submitted_at <= end_of_day_utc;

        remaining_tasks := total_items - completed_items;
        IF remaining_tasks <= 0 THEN CONTINUE; END IF;

        -- Dedup: one alert per checklist per hour
        v_dedup_key := 'overdue_' || cl.id || '_' || local_date || '_h' || local_hours::TEXT;

        -- Check recent notification log (59 min cooldown)
        IF EXISTS (
          SELECT 1 FROM checklist_notification_logs
          WHERE checklist_id = cl.id
            AND location_id = loc.id
            AND notification_type = 'overdue_hourly'
            AND sent_at >= now() - INTERVAL '59 minutes'
        ) THEN
          CONTINUE;
        END IF;

        -- Build notification body
        IF completed_items = 0 THEN
          v_body := cl.title || ' is not started';
        ELSE
          v_body := cl.title || ' not completed, ' || remaining_tasks || ' task' || 
                    CASE WHEN remaining_tasks = 1 THEN '' ELSE 's' END || ' remaining';
        END IF;

        -- Get admin/manager user IDs respecting notification preferences
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

        -- Queue the alert
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

        -- Log notification (for the 59-min cooldown check)
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
      v_employee_name TEXT;
      late_admin_ids UUID[];
    BEGIN
      -- Get admin user IDs for this location (for late arrival notifications)
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
        LOOP
          shift_start_minutes := EXTRACT(HOUR FROM shift.start_time::TIME)::INTEGER * 60 
                               + EXTRACT(MINUTE FROM shift.start_time::TIME)::INTEGER;
          minutes_since_start := current_total_minutes - shift_start_minutes;

          -- Only alert 15-20 min after shift start
          IF minutes_since_start < 15 OR minutes_since_start >= 20 THEN
            CONTINUE;
          END IF;

          -- Check for clock-in today
          SELECT EXISTS (
            SELECT 1 FROM time_punches tp
            WHERE tp.user_id = shift.user_id
              AND tp.punch_type = 'in'
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
              'body', shift.full_name || ' has not clocked in (shift started ' || 
                      to_char(shift.start_time::TIME, 'HH12:MI AM') || ')',
              'notification_type', 'late_arrivals',
              'data', jsonb_build_object('user_id', shift.user_id, 'type', 'late_arrival', 'location_id', loc.id)
            )
          )
          ON CONFLICT (dedup_key) DO NOTHING;
        END LOOP;
      END IF;
    END;

    -- ==================== MONTHLY CHECKLIST REMINDERS ====================
    DECLARE
      mcl RECORD;
      days_until_month_end INTEGER;
      last_day_of_month INTEGER;
      mc_total_items INTEGER;
      mc_completed INTEGER;
      mc_remaining INTEGER;
      mc_start_of_month TIMESTAMPTZ;
      mc_user_ids UUID[];
      urgency_text TEXT;
      days_text TEXT;
    BEGIN
      -- Only run at ~9:00 AM local
      IF local_hours = 9 AND local_minutes <= 15 THEN
        last_day_of_month := EXTRACT(DAY FROM (date_trunc('month', (local_date::DATE + INTERVAL '1 month')))::DATE - 1)::INTEGER;
        days_until_month_end := last_day_of_month - local_day_of_month;
        mc_start_of_month := date_trunc('month', now() AT TIME ZONE tz) AT TIME ZONE tz;

        -- Get all location users
        SELECT ARRAY_AGG(ul.user_id) INTO mc_user_ids
        FROM user_locations ul
        WHERE ul.location_id = loc.id;

        IF mc_user_ids IS NOT NULL THEN
          FOR mcl IN
            SELECT c.id, c.title, c.visible_days_before_month_end
            FROM checklists c
            WHERE c.is_active = true
              AND c.frequency = 'monthly'
              AND c.location_id = loc.id
              AND c.visible_days_before_month_end IS NOT NULL
          LOOP
            IF days_until_month_end >= mcl.visible_days_before_month_end THEN
              CONTINUE;
            END IF;

            SELECT COUNT(*) INTO mc_total_items FROM checklist_items WHERE checklist_id = mcl.id;
            IF mc_total_items = 0 THEN CONTINUE; END IF;

            SELECT COUNT(DISTINCT cr.item_id) INTO mc_completed
            FROM checklist_submissions cs
            JOIN checklist_responses cr ON cr.submission_id = cs.id
            WHERE cs.checklist_id = mcl.id
              AND cs.location_id = loc.id
              AND cs.submitted_at >= mc_start_of_month;

            mc_remaining := mc_total_items - mc_completed;
            IF mc_remaining <= 0 THEN CONTINUE; END IF;

            IF days_until_month_end <= 1 THEN urgency_text := 'FINAL DAY: ';
            ELSIF days_until_month_end <= 3 THEN urgency_text := 'URGENT: ';
            ELSE urgency_text := '';
            END IF;

            IF days_until_month_end = 0 THEN days_text := 'Due TODAY';
            ELSIF days_until_month_end = 1 THEN days_text := '1 day left';
            ELSE days_text := days_until_month_end || ' days left';
            END IF;

            v_dedup_key := 'monthly_' || mcl.id || '_' || local_date;

            INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
            VALUES (
              'monthly_checklist',
              v_dedup_key,
              loc.id,
              jsonb_build_object(
                'user_ids', to_jsonb(mc_user_ids),
                'title', urgency_text || 'Monthly Checklist - ' || loc.name,
                'body', mcl.title || ' - ' || mc_remaining || ' task' || 
                        CASE WHEN mc_remaining = 1 THEN '' ELSE 's' END || 
                        ' remaining (' || days_text || ')',
                'notification_type', 'overdue_checklists',
                'data', jsonb_build_object('checklist_id', mcl.id, 'type', 'monthly_checklist_reminder', 'location_id', loc.id)
              )
            )
            ON CONFLICT (dedup_key) DO NOTHING;
          END LOOP;
        END IF;
      END IF;
    END;

    -- ==================== CLOCK-IN CHECKLIST REMINDERS ====================
    DECLARE
      punch RECORD;
      reminder_cl RECORD;
      cl_due_minutes INTEGER;
      cl_total INTEGER;
      cl_done INTEGER;
      cl_remaining INTEGER;
      user_role_set TEXT[];
      cl_role_tags TEXT[];
      is_role_relevant BOOLEAN;
      reminder_body TEXT;
      relevant_count INTEGER;
    BEGIN
      FOR punch IN
        SELECT tp.user_id, tp.punch_time
        FROM time_punches tp
        WHERE tp.location_id = loc.id
          AND tp.punch_type = 'in'
          AND tp.punch_time >= now() - INTERVAL '17 minutes'
          AND tp.punch_time <= now() - INTERVAL '13 minutes'
      LOOP
        -- Check if already reminded today
        IF EXISTS (
          SELECT 1 FROM checklist_notification_logs
          WHERE location_id = loc.id
            AND notification_type = 'clock_in_reminder'
            AND trigger_user_id = punch.user_id
            AND sent_at >= start_of_day_utc
        ) THEN
          CONTINUE;
        END IF;

        -- Get user's roles
        SELECT ARRAY_AGG(role::TEXT) INTO user_role_set
        FROM user_roles WHERE user_id = punch.user_id;

        relevant_count := 0;

        FOR reminder_cl IN
          SELECT c.id, c.title, c.due_by_time, c.frequency, c.template_type
          FROM checklists c
          WHERE c.is_active = true
            AND c.location_id = loc.id
            AND c.due_by_time IS NOT NULL
            AND c.frequency IN ('daily', 'dynamic')
        LOOP
          -- Check if relevant today
          IF reminder_cl.template_type = 'dynamic' THEN
            IF NOT EXISTS (
              SELECT 1 FROM checklist_items ci
              WHERE ci.checklist_id = reminder_cl.id AND local_day = ANY(ci.days_of_week)
            ) THEN
              CONTINUE;
            END IF;
          END IF;

          cl_due_minutes := EXTRACT(HOUR FROM reminder_cl.due_by_time::TIME)::INTEGER * 60 
                          + EXTRACT(MINUTE FROM reminder_cl.due_by_time::TIME)::INTEGER;

          -- Skip if past due + 2 hours
          IF current_total_minutes > cl_due_minutes + 120 THEN CONTINUE; END IF;

          -- Check role tags
          SELECT ARRAY_AGG(crt.role::TEXT) INTO cl_role_tags
          FROM checklist_role_tags crt WHERE crt.checklist_id = reminder_cl.id;

          IF cl_role_tags IS NOT NULL AND array_length(cl_role_tags, 1) > 0 THEN
            is_role_relevant := user_role_set IS NOT NULL AND cl_role_tags && user_role_set;
            IF NOT is_role_relevant THEN CONTINUE; END IF;
          END IF;

          -- Count completion
          IF reminder_cl.template_type = 'dynamic' THEN
            SELECT COUNT(*) INTO cl_total FROM checklist_items ci
            WHERE ci.checklist_id = reminder_cl.id AND local_day = ANY(ci.days_of_week);
          ELSE
            SELECT COUNT(*) INTO cl_total FROM checklist_items WHERE checklist_id = reminder_cl.id;
          END IF;

          SELECT COUNT(DISTINCT cr.item_id) INTO cl_done
          FROM checklist_submissions cs
          JOIN checklist_responses cr ON cr.submission_id = cs.id
          WHERE cs.checklist_id = reminder_cl.id
            AND cs.location_id = loc.id
            AND cs.submitted_at >= start_of_day_utc
            AND cs.submitted_at <= end_of_day_utc;

          IF cl_done >= cl_total THEN CONTINUE; END IF;

          cl_remaining := cl_total - cl_done;
          relevant_count := relevant_count + 1;

          -- Build body for first relevant checklist found
          IF relevant_count = 1 THEN
            reminder_body := reminder_cl.title || ' has ' || cl_remaining || ' task' || 
                            CASE WHEN cl_remaining = 1 THEN '' ELSE 's' END || 
                            ' remaining (due ' || to_char(reminder_cl.due_by_time::TIME, 'HH12:MI AM') || ')';
          END IF;
        END LOOP;

        IF relevant_count = 0 THEN CONTINUE; END IF;

        IF relevant_count > 1 THEN
          reminder_body := relevant_count || ' checklists need attention';
        END IF;

        v_dedup_key := 'clockin_reminder_' || punch.user_id || '_' || local_date;

        INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
        VALUES (
          'clock_in_reminder',
          v_dedup_key,
          loc.id,
          jsonb_build_object(
            'user_ids', to_jsonb(ARRAY[punch.user_id]),
            'title', 'Checklist Reminder - ' || loc.name,
            'body', reminder_body,
            'notification_type', 'overdue_checklists',
            'data', jsonb_build_object('type', 'clock_in_checklist_reminder', 'location_id', loc.id)
          )
        )
        ON CONFLICT (dedup_key) DO NOTHING;

        -- Log the reminder
        INSERT INTO checklist_notification_logs (checklist_id, location_id, notification_type, trigger_user_id)
        VALUES ((SELECT id FROM checklists WHERE is_active = true AND location_id = loc.id LIMIT 1), loc.id, 'clock_in_reminder', punch.user_id);
      END LOOP;
    END;

  END LOOP; -- end location loop

  -- ==================== CERT EXPIRY (location-independent) ====================
  DECLARE
    cert RECORD;
    days_until_expiry INTEGER;
    cert_urgency TEXT;
    formatted_date TEXT;
    cert_user_name TEXT;
    cert_loc RECORD;
    cert_admin_ids UUID[];
  BEGIN
    -- Only run once daily at ~9 AM (check first location's timezone as proxy)
    -- This runs for all certs regardless of location
    FOR cert IN
      SELECT c.id, c.user_id, c.certification_type, c.expiration_date
      FROM certifications c
      WHERE c.status = 'approved'
        AND c.expiration_date >= CURRENT_DATE
        AND c.expiration_date <= CURRENT_DATE + 30
    LOOP
      days_until_expiry := (cert.expiration_date::DATE - CURRENT_DATE)::INTEGER;
      
      -- Only notify on specific days
      IF days_until_expiry NOT IN (30, 14, 7, 3, 1) THEN
        CONTINUE;
      END IF;

      v_dedup_key := 'cert_' || cert.id || '_' || days_until_expiry || 'd_' || CURRENT_DATE;

      IF days_until_expiry <= 3 THEN cert_urgency := 'URGENT: '; ELSE cert_urgency := ''; END IF;
      formatted_date := to_char(cert.expiration_date, 'Mon DD, YYYY');

      -- Notify the employee
      INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
      VALUES (
        'cert_expiry',
        v_dedup_key || '_user',
        NULL,
        jsonb_build_object(
          'user_ids', to_jsonb(ARRAY[cert.user_id]),
          'title', cert_urgency || 'Certification Expiring',
          'body', 'Your ' || cert.certification_type || ' expires ' || formatted_date || 
                  ' (' || days_until_expiry || ' day' || CASE WHEN days_until_expiry = 1 THEN '' ELSE 's' END || ')',
          'notification_type', 'certification_expiring',
          'data', jsonb_build_object('certification_id', cert.id, 'type', 'certification_expiring')
        )
      )
      ON CONFLICT (dedup_key) DO NOTHING;

      -- Notify managers at each of the user's locations
      SELECT full_name INTO cert_user_name FROM profiles WHERE id = cert.user_id;

      FOR cert_loc IN
        SELECT ul.location_id, l.name AS location_name
        FROM user_locations ul
        JOIN locations l ON l.id = ul.location_id
        WHERE ul.user_id = cert.user_id
      LOOP
        SELECT ARRAY_AGG(ur.user_id) INTO cert_admin_ids
        FROM user_locations ul2
        JOIN user_roles ur ON ur.user_id = ul2.user_id
        WHERE ul2.location_id = cert_loc.location_id
          AND ur.role IN ('super_admin', 'org_admin', 'admin', 'manager', 'general_manager', 'shift_manager')
          AND NOT EXISTS (
            SELECT 1 FROM user_notification_settings uns
            WHERE uns.user_id = ur.user_id
              AND uns.location_id = cert_loc.location_id
              AND uns.notification_type = 'certification_expiring'
              AND uns.push_enabled = false
          );

        IF cert_admin_ids IS NOT NULL AND array_length(cert_admin_ids, 1) > 0 THEN
          INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
          VALUES (
            'cert_expiry',
            v_dedup_key || '_mgr_' || cert_loc.location_id,
            cert_loc.location_id,
            jsonb_build_object(
              'user_ids', to_jsonb(cert_admin_ids),
              'title', cert_urgency || 'Certification Expiring - ' || cert_loc.location_name,
              'body', COALESCE(cert_user_name, 'Employee') || '''s ' || cert.certification_type || ' expires ' || formatted_date,
              'notification_type', 'certification_expiring',
              'data', jsonb_build_object('certification_id', cert.id, 'user_id', cert.user_id, 'type', 'certification_expiring', 'location_id', cert_loc.location_id)
            )
          )
          ON CONFLICT (dedup_key) DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;
  END;

END;
$function$;

-- ============================================================
-- Cleanup: Drop old alarm_trigger_queue (after data migrated above)
-- ============================================================
DROP TABLE IF EXISTS public.alarm_trigger_queue;
