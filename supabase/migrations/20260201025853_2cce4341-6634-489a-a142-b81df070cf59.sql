-- Add "Read & Sign" category to ALL existing locations that don't have it
INSERT INTO public.logbook_categories (name, location_id, display_order, is_active, alert_enabled, push_notification_enabled)
SELECT 
  'Read & Sign',
  l.id,
  1000, -- High display order to appear at end
  true,
  false,
  false
FROM public.locations l
WHERE NOT EXISTS (
  SELECT 1 FROM public.logbook_categories lc 
  WHERE lc.location_id = l.id 
  AND lc.name ILIKE '%read%sign%'
);

-- Create a trigger function to auto-add "Read & Sign" category when a new location is created
CREATE OR REPLACE FUNCTION public.auto_create_read_and_sign_category()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.logbook_categories (name, location_id, display_order, is_active, alert_enabled, push_notification_enabled)
  VALUES ('Read & Sign', NEW.id, 1000, true, false, false);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to run after location insert
DROP TRIGGER IF EXISTS trigger_auto_create_read_and_sign ON public.locations;
CREATE TRIGGER trigger_auto_create_read_and_sign
  AFTER INSERT ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_read_and_sign_category();