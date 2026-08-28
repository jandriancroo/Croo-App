CREATE OR REPLACE FUNCTION public.check_weekly_checklist_alerts_sql()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  loc RECORD;
  tz TEXT;
  local_date TEXT;
  local_day INTEGER;
  business_local_day_mon0 INTEGER;
  local_hours INTEGER;
  local_minutes INTEGER;
  current_total_minutes INTEGER;
  week_start_date DATE;
  week_start_utc TIMESTAMPTZ;
  cl RECORD;
  due_total_minutes INTEGER;
  total_items INTEGER;
  completed_items INTEGER;
  remaining_tasks INTEGER;
  v_body TEXT;
  v_family UUID;
  v_dedup_key TEXT;
  admin_user_ids UUID[];
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
    business_local_day_mon0 := (local_day + 6) % 7;

    -- Weekly lists are only chased on the last day of their week (Sunday, Mon=0..Sun=6).
    IF business_local_day_mon0 <> 6 THEN CONTINUE; END IF;

    week_start_date := local_date::DATE - business_local_day_mon0;
    week_start_utc := (to_char(week_start_date, 'YYYY-MM-DD') || 'T00:00:00')::TIMESTAMP AT TIME ZONE tz;

    FOR cl IN
      SELECT c.id, c.title, c.due_by_time, COALESCE(c.family_id, c.id) AS family_id
      FROM checklists c
      WHERE c.is_active = true
        AND c.superseded_at IS NULL
        AND c.location_id = loc.id
        AND c.due_by_time IS NOT NULL
        AND c.frequency = 'weekly'
        AND COALESCE(c.template_type, 'standard') <> 'dynamic'
    LOOP
      v_family := cl.family_id;
      due_total_minutes := EXTRACT(HOUR FROM cl.due_by_time::TIME)::INTEGER * 60
                         + EXTRACT(MINUTE FROM cl.due_by_time::TIME)::INTEGER;
      IF current_total_minutes < due_total_minutes THEN CONTINUE; END IF;
      IF current_total_minutes > due_total_minutes + 180 THEN CONTINUE; END IF;

      WITH base AS (
        SELECT ci.id, ci.item_type, ci.order_index,
          (
            SELECT MAX(ci2.order_index)
            FROM checklist_items ci2
            WHERE ci2.checklist_id = ci.checklist_id
              AND ci2.item_type = 'section_header'
              AND ci2.order_index <= ci.order_index
              AND ci2.deleted_at IS NULL
          ) AS section_anchor
        FROM checklist_items ci
        WHERE ci.checklist_id = cl.id AND ci.deleted_at IS NULL
      ),
      answered_items AS (
        SELECT DISTINCT cr.item_id
        FROM checklist_submissions cs
        JOIN checklist_responses cr ON cr.submission_id = cs.id
        JOIN checklist_items ci_live ON ci_live.id = cr.item_id AND ci_live.deleted_at IS NULL
        WHERE cs.checklist_id = cl.id
          AND cs.location_id = loc.id
          AND cs.submitted_at >= week_start_utc
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
      INTO total_items, completed_items
      FROM base;

      IF total_items IS NULL OR total_items = 0 THEN CONTINUE; END IF;
      remaining_tasks := GREATEST(0, total_items - COALESCE(completed_items, 0));
      IF remaining_tasks <= 0 THEN CONTINUE; END IF;

      v_dedup_key := 'overdue_weekly_' || v_family || '_' || local_date || '_h' || local_hours::TEXT;
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
        v_body := cl.title || ' not completed, ' || remaining_tasks || ' task'
                  || CASE WHEN remaining_tasks = 1 THEN '' ELSE 's' END || ' remaining';
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
      IF admin_user_ids IS NULL OR array_length(admin_user_ids, 1) IS NULL THEN CONTINUE; END IF;

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
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.check_weekly_checklist_alerts_sql() FROM anon, authenticated;

SELECT cron.schedule(
  'check-weekly-checklist-alerts',
  '*/5 * * * *',
  $$SELECT public.check_weekly_checklist_alerts_sql();$$
);