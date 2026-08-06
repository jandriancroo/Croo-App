CREATE OR REPLACE FUNCTION public.mark_labor_cache_stale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  punch_date date;
  tz text;
BEGIN
  BEGIN
    SELECT ls.timezone INTO tz FROM public.location_settings ls
      WHERE ls.location_id = COALESCE(NEW.location_id, OLD.location_id);
    tz := COALESCE(tz, 'America/Los_Angeles');

    IF TG_OP = 'DELETE' THEN
      punch_date := (OLD.punch_time AT TIME ZONE tz)::date;

      UPDATE public.labor_cache
      SET is_stale = true
      WHERE location_id = OLD.location_id
        AND labor_date = punch_date
        AND source = 'punch_clock';
    ELSE
      punch_date := (NEW.punch_time AT TIME ZONE tz)::date;

      UPDATE public.labor_cache
      SET is_stale = true
      WHERE location_id = NEW.location_id
        AND labor_date = punch_date
        AND source = 'punch_clock';

      IF TG_OP = 'UPDATE' AND OLD.punch_time IS DISTINCT FROM NEW.punch_time THEN
        UPDATE public.labor_cache
        SET is_stale = true
        WHERE location_id = OLD.location_id
          AND labor_date = (OLD.punch_time AT TIME ZONE tz)::date
          AND source = 'punch_clock';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mark_labor_cache_stale skipped: %', SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$;