-- Allow kiosk (anon) to log PIN attempts
DROP POLICY IF EXISTS "Authenticated users can log attempts" ON public.punch_clock_attempts;
CREATE POLICY "Anyone can log punch clock attempts"
ON public.punch_clock_attempts
FOR INSERT
TO public
WITH CHECK (true);

-- Shorten retention default from 30 to 7 days
CREATE OR REPLACE FUNCTION public.prune_punch_clock_attempts(days_to_keep integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  WITH d AS (
    DELETE FROM public.punch_clock_attempts
    WHERE created_at < (now() - (days_to_keep || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;
  RETURN deleted_count;
END;
$function$;