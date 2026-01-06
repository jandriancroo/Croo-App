-- Add app_version column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS app_version TEXT;

-- Add index for quick lookups on outdated users
CREATE INDEX IF NOT EXISTS idx_profiles_app_version ON public.profiles(app_version);