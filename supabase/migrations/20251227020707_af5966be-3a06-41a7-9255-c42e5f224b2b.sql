-- Create default week templates for existing locations that don't have one
INSERT INTO public.week_templates (template_name, location_id, description)
SELECT 
  'Default Weekly',
  l.id,
  'Auto-generated default template'
FROM public.locations l
WHERE NOT EXISTS (
  SELECT 1 FROM public.week_templates wt WHERE wt.location_id = l.id
);

-- Create function to auto-create week template for new locations
CREATE OR REPLACE FUNCTION public.create_default_week_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.week_templates (template_name, location_id, description)
  VALUES ('Default Weekly', NEW.id, 'Auto-generated default template');
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS create_default_week_template_trigger ON public.locations;
CREATE TRIGGER create_default_week_template_trigger
  AFTER INSERT ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_week_template();