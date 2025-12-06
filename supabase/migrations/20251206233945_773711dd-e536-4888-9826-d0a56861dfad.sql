-- Add appears_on_schedule column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS appears_on_schedule boolean NOT NULL DEFAULT true;

-- Add comment
COMMENT ON COLUMN public.profiles.appears_on_schedule IS 'Controls whether user appears in schedule employee list. Managed by managers and admins.';

-- Update existing availability requests that have NULL location_id
-- Set them to Hemet location (the primary location)
UPDATE public.availability_requests 
SET location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6' 
WHERE location_id IS NULL;