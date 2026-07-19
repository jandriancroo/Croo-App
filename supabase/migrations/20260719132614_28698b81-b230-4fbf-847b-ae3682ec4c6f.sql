-- Guard signup triggers against paired punch clock devices.
-- Devices get their own auth.users row (so they have real sessions), but must
-- NEVER appear in profiles/user_roles/user_locations rosters. The existing
-- handle_new_user + handle_new_user_role triggers unconditionally insert
-- into profiles + user_roles — this update makes them no-op when the new
-- auth user carries the is_punch_device flag in metadata.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip paired punch clock device users; they must not appear in profiles.
  IF COALESCE((NEW.raw_user_meta_data->>'is_punch_device')::boolean, false) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, profile_photo_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'profile_photo_url', NULL)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip paired punch clock device users; they must have no role in the app.
  IF COALESCE((NEW.raw_user_meta_data->>'is_punch_device')::boolean, false) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'team_member'::app_role);
  RETURN NEW;
END;
$function$;