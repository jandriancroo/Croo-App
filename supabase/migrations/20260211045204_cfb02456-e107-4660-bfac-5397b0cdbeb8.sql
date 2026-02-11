
-- Create the alarm trigger queue table (decouples timing from delivery)
CREATE TABLE public.alarm_trigger_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.temporary_tasks(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  interval_key TEXT NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  push_sent BOOLEAN NOT NULL DEFAULT false,
  push_sent_at TIMESTAMPTZ,
  push_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the push-sender to find unsent triggers quickly
CREATE INDEX idx_alarm_trigger_queue_unsent ON public.alarm_trigger_queue (push_sent, created_at) WHERE push_sent = false;

-- Index to prevent duplicate triggers for same task+interval
CREATE UNIQUE INDEX idx_alarm_trigger_queue_unique ON public.alarm_trigger_queue (task_id, interval_key);

-- Enable RLS (only service role / DB functions will access this)
ALTER TABLE public.alarm_trigger_queue ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (for debugging), but only service role writes
CREATE POLICY "Admins can view alarm trigger queue"
  ON public.alarm_trigger_queue
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Clean up old queue entries after 7 days (handled by nightly maintenance)
-- No policy for INSERT/UPDATE/DELETE — only service role and SQL functions

-- Create the SQL function that runs every minute via pg_cron
CREATE OR REPLACE FUNCTION public.trigger_alarm_tasks_sql()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  tz TEXT;
  local_parts RECORD;
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
  interval_key TEXT;
  min_gap_minutes INTEGER;
  minutes_since_last DOUBLE PRECISION;
BEGIN
  -- Loop through all active recurring alarm tasks
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

    -- Get local time in the location's timezone
    SELECT 
      EXTRACT(DOW FROM now() AT TIME ZONE tz)::INTEGER,
      to_char(now() AT TIME ZONE tz, 'HH24:MI'),
      to_char(now() AT TIME ZONE tz, 'YYYY-MM-DD'),
      EXTRACT(HOUR FROM now() AT TIME ZONE tz)::INTEGER * 60 + EXTRACT(MINUTE FROM now() AT TIME ZONE tz)::INTEGER
    INTO day_of_week, time_str, date_str, current_minute_of_day;

    -- Check if task is active today
    IF rec.days_of_week IS NULL OR NOT (day_of_week = ANY(rec.days_of_week)) THEN
      CONTINUE;
    END IF;

    -- Check if within active hours
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
      -- Interval-based: check if we're near a boundary
      last_boundary := (current_minute_of_day / rec.frequency_minutes) * rec.frequency_minutes;
      distance_to_last := current_minute_of_day - last_boundary;

      -- 2-minute tolerance window
      IF distance_to_last <= 2 THEN
        boundary_minute := last_boundary;
      ELSIF (last_boundary + rec.frequency_minutes) - current_minute_of_day <= 2 THEN
        boundary_minute := last_boundary + rec.frequency_minutes;
      ELSE
        boundary_minute := NULL;
      END IF;

      IF boundary_minute IS NOT NULL THEN
        matched_time := lpad((boundary_minute / 60)::TEXT, 2, '0') || ':' || lpad((boundary_minute % 60)::TEXT, 2, '0');

        -- Cooldown check
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
      -- Custom times: exact match
      IF time_str = ANY(rec.custom_times) THEN
        should_trigger := true;
        matched_time := time_str;
      END IF;
    END IF;

    IF NOT should_trigger OR matched_time IS NULL THEN
      CONTINUE;
    END IF;

    interval_key := date_str || '_' || replace(matched_time, ':', '');

    -- Check if already completed for this interval
    IF EXISTS (
      SELECT 1 FROM alarm_task_completions 
      WHERE task_id = rec.id AND alarm_task_completions.interval_key = trigger_alarm_tasks_sql.interval_key
    ) THEN
      CONTINUE;
    END IF;

    -- Insert into trigger queue (skip if already queued for this interval)
    INSERT INTO alarm_trigger_queue (task_id, location_id, interval_key)
    VALUES (rec.id, rec.location_id, interval_key)
    ON CONFLICT (task_id, interval_key) DO NOTHING;

    -- Update last_triggered_at
    UPDATE temporary_tasks SET last_triggered_at = now() WHERE id = rec.id;

    RAISE LOG '[alarm-sql] Triggered task % (%): interval_key=%, local_time=%', rec.id, rec.title, interval_key, time_str;
  END LOOP;
END;
$$;
