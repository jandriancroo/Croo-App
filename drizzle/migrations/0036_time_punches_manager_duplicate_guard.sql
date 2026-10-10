CREATE OR REPLACE FUNCTION public.guard_manager_duplicate_punch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_end timestamptz;
BEGIN
  -- Only manager-added rows: kiosk/self punches and auto punch-outs pass through.
  IF NEW.created_by IS NULL OR NEW.created_by = NEW.user_id
     OR coalesce(NEW.is_auto_punched_out, false)
     OR NEW.shift_id IS NULL
     OR NEW.punch_type NOT IN ('clock_out','break_start','break_end') THEN
    RETURN NEW;
  END IF;

  -- Serialize two managers saving the same shift at once.
  PERFORM pg_advisory_xact_lock(hashtext('punch_guard:' || NEW.shift_id::text));

  IF NEW.punch_type = 'clock_out' THEN
    IF EXISTS (
      SELECT 1 FROM public.time_punches o
      WHERE o.shift_id = NEW.shift_id AND o.user_id = NEW.user_id AND o.punch_type = 'clock_out'
        AND NOT EXISTS (
          SELECT 1 FROM public.time_punches i
          WHERE i.shift_id = NEW.shift_id AND i.user_id = NEW.user_id AND i.punch_type = 'clock_in'
            AND i.punch_time > least(o.punch_time, NEW.punch_time)
            AND i.punch_time < greatest(o.punch_time, NEW.punch_time)
        )
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_CLOCK_OUT: this shift already has a clock-out' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- Same break punch type within 2 minutes = duplicate.
  IF EXISTS (
    SELECT 1 FROM public.time_punches p
    WHERE p.shift_id = NEW.shift_id AND p.user_id = NEW.user_id AND p.punch_type = NEW.punch_type
      AND abs(extract(epoch FROM (p.punch_time - NEW.punch_time))) < 120
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_BREAK: that break is already on this shift' USING ERRCODE = 'P0001';
  END IF;

  -- New punch falls inside an existing break (start .. its first end, or open-ended).
  IF EXISTS (
    SELECT 1 FROM public.time_punches s
    WHERE s.shift_id = NEW.shift_id AND s.user_id = NEW.user_id AND s.punch_type = 'break_start'
      AND s.punch_time < NEW.punch_time
      AND (
        SELECT min(e.punch_time) FROM public.time_punches e
        WHERE e.shift_id = NEW.shift_id AND e.user_id = NEW.user_id AND e.punch_type = 'break_end'
          AND e.punch_time > s.punch_time
      ) IS NOT NULL
      AND NEW.punch_time < (
        SELECT min(e.punch_time) FROM public.time_punches e
        WHERE e.shift_id = NEW.shift_id AND e.user_id = NEW.user_id AND e.punch_type = 'break_end'
          AND e.punch_time > s.punch_time
      )
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_BREAK: that break overlaps one already on this shift' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_manager_duplicate_punch() FROM PUBLIC, anon, authenticated;

-- Name sorts after trg_resolve_shift_id so shift_id is already attached.
DROP TRIGGER IF EXISTS trg_zz_guard_manager_duplicate_punch ON public.time_punches;
CREATE TRIGGER trg_zz_guard_manager_duplicate_punch
BEFORE INSERT ON public.time_punches
FOR EACH ROW EXECUTE FUNCTION public.guard_manager_duplicate_punch();