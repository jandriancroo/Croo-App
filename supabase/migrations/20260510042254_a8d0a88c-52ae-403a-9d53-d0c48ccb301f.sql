
-- 1. Phantom marker
ALTER TABLE public.scheduled_shifts
  ADD COLUMN IF NOT EXISTS is_phantom BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_user_date
  ON public.scheduled_shifts (user_id, shift_date);

-- 2. Resolver: inherit open sequence -> match scheduled -> create phantom
CREATE OR REPLACE FUNCTION public.resolve_or_create_shift_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz            text;
  v_local_ts      timestamp;
  v_local_date    date;
  v_local_time    time;
  v_inherited     uuid;
  v_scheduled     uuid;
  v_phantom       uuid;
  v_last_open     record;
BEGIN
  -- Honor explicit shift_id on insert
  IF NEW.shift_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL OR NEW.punch_time IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve location timezone (fallback to PT)
  SELECT timezone INTO v_tz
  FROM public.location_settings
  WHERE location_id = NEW.location_id
  LIMIT 1;
  v_tz := COALESCE(v_tz, 'America/Los_Angeles');

  v_local_ts   := (NEW.punch_time AT TIME ZONE v_tz);
  v_local_date := v_local_ts::date;
  v_local_time := v_local_ts::time;

  -- (A) Inherit from the user's currently-open punch sequence
  --     (last clock_in within 24h that has no later clock_out).
  --     This handles overnight shifts: a 2am clock_out inherits last night's shift_id.
  SELECT tp.shift_id, tp.punch_time
    INTO v_last_open
  FROM public.time_punches tp
  WHERE tp.user_id = NEW.user_id
    AND tp.punch_type = 'clock_in'
    AND tp.shift_id IS NOT NULL
    AND tp.punch_time > (NEW.punch_time - interval '24 hours')
    AND tp.punch_time <= NEW.punch_time
    AND NOT EXISTS (
      SELECT 1 FROM public.time_punches tp2
      WHERE tp2.user_id = tp.user_id
        AND tp2.punch_type = 'clock_out'
        AND tp2.punch_time > tp.punch_time
        AND tp2.punch_time <= NEW.punch_time
    )
  ORDER BY tp.punch_time DESC
  LIMIT 1;

  IF v_last_open.shift_id IS NOT NULL THEN
    NEW.shift_id := v_last_open.shift_id;
    RETURN NEW;
  END IF;

  -- (B) Match scheduled shift for this user on the local business date
  SELECT id INTO v_scheduled
  FROM public.scheduled_shifts
  WHERE user_id = NEW.user_id
    AND shift_date = v_local_date
    AND COALESCE(is_time_off, false) = false
  ORDER BY ABS(EXTRACT(EPOCH FROM (start_time - v_local_time))) ASC
  LIMIT 1;

  IF v_scheduled IS NOT NULL THEN
    NEW.shift_id := v_scheduled;
    RETURN NEW;
  END IF;

  -- (C) Create a phantom shift (8h default window)
  INSERT INTO public.scheduled_shifts (
    user_id,
    shift_date,
    day_of_week,
    start_time,
    end_time,
    is_phantom,
    is_time_off
  )
  VALUES (
    NEW.user_id,
    v_local_date,
    EXTRACT(DOW FROM v_local_date)::int,
    v_local_time,
    (v_local_ts + interval '8 hours')::time,
    true,
    false
  )
  RETURNING id INTO v_phantom;

  NEW.shift_id := v_phantom;
  RETURN NEW;
END;
$$;

-- 3. Trigger: stop the bleed on every new punch
DROP TRIGGER IF EXISTS trg_resolve_shift_id ON public.time_punches;
CREATE TRIGGER trg_resolve_shift_id
  BEFORE INSERT ON public.time_punches
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_or_create_shift_id();
