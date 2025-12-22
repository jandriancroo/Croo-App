-- Create a function to trigger daily logbook summary email when drawer count is submitted
CREATE OR REPLACE FUNCTION public.trigger_daily_logbook_summary()
RETURNS TRIGGER AS $$
DECLARE
  drawer_count_category_id uuid;
  location_timezone text;
  entry_date_str text;
BEGIN
  -- Check if this is a drawer count entry
  SELECT id INTO drawer_count_category_id 
  FROM public.logbook_categories 
  WHERE id = NEW.category_id 
    AND LOWER(name) = 'drawer count'
  LIMIT 1;
  
  -- Only proceed if this is a drawer count entry
  IF drawer_count_category_id IS NOT NULL THEN
    -- Get the entry date
    entry_date_str := NEW.entry_date::text;
    
    -- Call the edge function to send the daily summary
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/send-daily-logbook-summary',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg'
      ),
      body := jsonb_build_object(
        'location_id', NEW.location_id,
        'entry_date', entry_date_str
      )
    );
    
    RAISE LOG 'Triggered daily logbook summary for location % on %', NEW.location_id, entry_date_str;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create the trigger on logbook_entries
DROP TRIGGER IF EXISTS trigger_logbook_summary_on_drawer_count ON public.logbook_entries;

CREATE TRIGGER trigger_logbook_summary_on_drawer_count
  AFTER INSERT ON public.logbook_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_daily_logbook_summary();