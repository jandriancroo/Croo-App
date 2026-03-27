
-- Replace the trigger function to only assign super_admins to new locations
-- Previously it was assigning ALL admins across ALL orgs which is a critical bug
CREATE OR REPLACE FUNCTION public.assign_admins_to_new_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only assign super_admins to new locations
  -- All other users should be explicitly invited/assigned
  INSERT INTO public.user_locations (user_id, location_id)
  SELECT ur.user_id, NEW.id
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'::app_role;
  
  RETURN NEW;
END;
$function$;
