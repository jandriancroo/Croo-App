-- Add punch clock customization and birthday settings to location_settings
ALTER TABLE public.location_settings
ADD COLUMN IF NOT EXISTS punch_clock_background_url text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS punch_clock_overlay_text text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS punch_clock_text_color text DEFAULT '#FFFFFF',
ADD COLUMN IF NOT EXISTS birthday_events_enabled boolean DEFAULT true;

-- Add comment for clarity
COMMENT ON COLUMN public.location_settings.punch_clock_background_url IS 'Custom background image URL for punch clock';
COMMENT ON COLUMN public.location_settings.punch_clock_overlay_text IS 'Custom text overlay for punch clock';
COMMENT ON COLUMN public.location_settings.punch_clock_text_color IS 'Text color for punch clock overlay';
COMMENT ON COLUMN public.location_settings.birthday_events_enabled IS 'Whether birthday events appear on schedule';