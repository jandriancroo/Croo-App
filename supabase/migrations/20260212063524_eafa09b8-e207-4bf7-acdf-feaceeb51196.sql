
-- Queue table for per-location nightly maintenance tasks
CREATE TABLE public.maintenance_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_type TEXT NOT NULL, -- 'daily_summary', 'weekly_summary', 'backfill_labor', 'weekly_schedule_email'
  location_id UUID NOT NULL REFERENCES public.locations(id),
  target_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'done', 'error'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  UNIQUE(task_type, location_id, target_date)
);

ALTER TABLE public.maintenance_queue ENABLE ROW LEVEL SECURITY;

-- Only service role accesses this table
CREATE POLICY "Service role only" ON public.maintenance_queue
  FOR ALL USING (false);

-- Index for the processor to grab pending work
CREATE INDEX idx_maintenance_queue_pending 
  ON public.maintenance_queue(status, created_at) 
  WHERE status IN ('pending', 'error');

-- DB function: called by cron at 3 AM PST
-- Inserts one row per active location per task type
CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yesterday DATE;
  v_today DATE;
  v_dow INT; -- 0=Sun, 1=Mon, ...
  v_location RECORD;
BEGIN
  -- Calculate dates in LA timezone
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_yesterday := v_today - INTERVAL '1 day';
  v_dow := EXTRACT(DOW FROM v_today);

  FOR v_location IN 
    SELECT id FROM locations WHERE is_active = true
  LOOP
    -- Daily summary email (every night, for yesterday)
    INSERT INTO maintenance_queue (task_type, location_id, target_date)
    VALUES ('daily_summary', v_location.id, v_yesterday)
    ON CONFLICT (task_type, location_id, target_date) DO NOTHING;

    -- Backfill yesterday's labor cache
    INSERT INTO maintenance_queue (task_type, location_id, target_date)
    VALUES ('backfill_labor', v_location.id, v_yesterday)
    ON CONFLICT (task_type, location_id, target_date) DO NOTHING;

    -- Weekly summary (Monday only, for previous week)
    IF v_dow = 1 THEN
      INSERT INTO maintenance_queue (task_type, location_id, target_date)
      VALUES ('weekly_summary', v_location.id, v_yesterday)
      ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
