-- Fix RLS policies to allow trigger-based user creation

-- Drop and recreate handle_new_user function with proper RLS bypass
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into profiles (bypasses RLS due to security definer)
  INSERT INTO public.profiles (id, email, full_name, profile_photo_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'profile_photo_url', NULL)
  );
  RETURN NEW;
END;
$$;

-- Drop and recreate handle_new_user_role function with proper RLS bypass
DROP FUNCTION IF EXISTS public.handle_new_user_role() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert default team_member role (bypasses RLS due to security definer)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'team_member'::app_role);
  RETURN NEW;
END;
$$;

-- Recreate triggers in correct order
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;

-- Trigger for profile creation (runs first)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Trigger for role assignment (runs second)
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();