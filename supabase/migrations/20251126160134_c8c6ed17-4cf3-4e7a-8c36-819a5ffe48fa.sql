-- Create function to validate location code without requiring user to be logged in
CREATE OR REPLACE FUNCTION public.validate_location_code(p_code text)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT l.id, l.name
  FROM public.locations l
  WHERE lower(l.location_code) = lower(p_code)
  LIMIT 1;
$$;