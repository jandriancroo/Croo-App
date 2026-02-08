-- Create a function to check for duplicate/overlapping availability requests
CREATE OR REPLACE FUNCTION public.prevent_duplicate_availability_requests()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  overlap_exists boolean;
BEGIN
  -- Check for overlapping date ranges for the same user
  SELECT EXISTS (
    SELECT 1
    FROM public.availability_requests ar
    WHERE ar.user_id = NEW.user_id
      AND ar.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND ar.status != 'denied' -- Don't count denied requests as duplicates
      AND (
        -- Single day overlap: new request's date range overlaps with existing
        (NEW.end_date IS NULL AND ar.end_date IS NULL AND ar.start_date = NEW.start_date)
        OR
        -- New is single day, existing is multi-day
        (NEW.end_date IS NULL AND ar.end_date IS NOT NULL AND NEW.start_date >= ar.start_date AND NEW.start_date <= ar.end_date)
        OR
        -- New is multi-day, existing is single day
        (NEW.end_date IS NOT NULL AND ar.end_date IS NULL AND ar.start_date >= NEW.start_date AND ar.start_date <= NEW.end_date)
        OR
        -- Both are multi-day with overlapping ranges
        (NEW.end_date IS NOT NULL AND ar.end_date IS NOT NULL 
         AND NEW.start_date <= ar.end_date AND NEW.end_date >= ar.start_date)
      )
    LIMIT 1
  ) INTO overlap_exists;

  IF overlap_exists THEN
    RAISE EXCEPTION 'A time-off request already exists for this date range'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger to enforce the constraint
DROP TRIGGER IF EXISTS check_duplicate_availability_requests ON public.availability_requests;
CREATE TRIGGER check_duplicate_availability_requests
  BEFORE INSERT OR UPDATE ON public.availability_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_availability_requests();