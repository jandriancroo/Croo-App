-- Update the function to trigger on BOTH drawer count AND PM safe count
CREATE OR REPLACE FUNCTION public.trigger_daily_logbook_summary()
RETURNS TRIGGER AS $$
DECLARE
  category_name text;
  entry_date_str text;
BEGIN
  -- Get the category name for this entry
  SELECT LOWER(name) INTO category_name 
  FROM public.logbook_categories 
  WHERE id = NEW.category_id
  LIMIT 1;
  
  -- Only proceed if this is a drawer count OR safe count entry
  IF category_name IN ('drawer count', 'safe count') THEN
    -- Get the entry date
    entry_date_str := NEW.entry_date::text;
    
    -- Call the edge function to send the daily summary
    -- The edge function will check if BOTH PM safe count and drawer count are complete
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
    
    RAISE LOG 'Triggered daily logbook summary check for location % on % (category: %)', NEW.location_id, entry_date_str, category_name;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;