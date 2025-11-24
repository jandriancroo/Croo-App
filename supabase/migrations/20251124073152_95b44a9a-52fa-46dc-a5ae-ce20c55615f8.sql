-- Add trigger to auto-generate PIN for new profiles if not provided
CREATE OR REPLACE FUNCTION public.assign_employee_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only assign PIN if it's NULL
  IF NEW.employee_pin IS NULL THEN
    NEW.employee_pin := public.generate_unique_pin();
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on profiles insert
DROP TRIGGER IF EXISTS assign_pin_on_insert ON public.profiles;
CREATE TRIGGER assign_pin_on_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_employee_pin();

-- Auto-assign PINs to existing users who don't have one
DO $$
DECLARE
  profile_record RECORD;
  new_pin TEXT;
BEGIN
  FOR profile_record IN 
    SELECT id FROM public.profiles WHERE employee_pin IS NULL
  LOOP
    new_pin := public.generate_unique_pin();
    UPDATE public.profiles 
    SET employee_pin = new_pin 
    WHERE id = profile_record.id;
  END LOOP;
END $$;