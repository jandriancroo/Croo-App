
-- Add all_locations_enabled column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS all_locations_enabled boolean NOT NULL DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.profiles.all_locations_enabled IS 'When true, user has access to all locations in their organization regardless of user_locations assignments';
