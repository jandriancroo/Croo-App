-- 1. Add staleness tracking to labor_cache
ALTER TABLE public.labor_cache 
ADD COLUMN IF NOT EXISTS is_stale boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS last_validated_at timestamptz;

-- 2. Create function to mark labor cache as stale when punches change
CREATE OR REPLACE FUNCTION public.mark_labor_cache_stale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  punch_date text;
  tz text := 'America/Los_Angeles';
BEGIN
  -- Get the business date for this punch in PST
  IF TG_OP = 'DELETE' THEN
    punch_date := to_char(OLD.punch_time AT TIME ZONE tz, 'YYYY-MM-DD');
    
    UPDATE public.labor_cache 
    SET is_stale = true
    WHERE location_id = OLD.location_id 
      AND labor_date = punch_date
      AND source = 'punch_clock';
  ELSE
    punch_date := to_char(NEW.punch_time AT TIME ZONE tz, 'YYYY-MM-DD');
    
    UPDATE public.labor_cache 
    SET is_stale = true
    WHERE location_id = NEW.location_id 
      AND labor_date = punch_date
      AND source = 'punch_clock';
      
    -- If punch was moved to a different date, also mark the old date as stale
    IF TG_OP = 'UPDATE' AND OLD.punch_time IS DISTINCT FROM NEW.punch_time THEN
      UPDATE public.labor_cache 
      SET is_stale = true
      WHERE location_id = OLD.location_id 
        AND labor_date = to_char(OLD.punch_time AT TIME ZONE tz, 'YYYY-MM-DD')
        AND source = 'punch_clock';
    END IF;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. Create trigger on time_punches
DROP TRIGGER IF EXISTS trigger_mark_labor_cache_stale ON public.time_punches;
CREATE TRIGGER trigger_mark_labor_cache_stale
AFTER INSERT OR UPDATE OR DELETE ON public.time_punches
FOR EACH ROW
EXECUTE FUNCTION public.mark_labor_cache_stale();

-- 4. Create index for faster stale lookups
CREATE INDEX IF NOT EXISTS idx_labor_cache_stale ON public.labor_cache (is_stale) WHERE is_stale = true;