-- Add weekly availability column to profiles for detailed time windows
-- This stores structured availability like {"monday": {"start": "10:00", "end": "15:00"}, "tuesday": {"not_available": true}}
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS weekly_availability JSONB DEFAULT NULL;

COMMENT ON COLUMN public.profiles.weekly_availability IS 'Detailed weekly availability per day with start/end times or not_available flags';