-- Add timezone column to location_settings
ALTER TABLE public.location_settings 
ADD COLUMN timezone text NOT NULL DEFAULT 'America/Los_Angeles';

-- Add comment for clarity
COMMENT ON COLUMN public.location_settings.timezone IS 'IANA timezone identifier for this location (e.g., America/Los_Angeles, America/New_York)';