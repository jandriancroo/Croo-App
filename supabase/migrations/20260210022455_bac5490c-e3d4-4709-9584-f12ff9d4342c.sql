-- Add per-location schedule visibility
ALTER TABLE public.user_locations
ADD COLUMN show_on_schedule boolean NOT NULL DEFAULT true;

-- Comment for clarity
COMMENT ON COLUMN public.user_locations.show_on_schedule IS 'Whether this user appears on the schedule grid at this location. Admins default to hidden, can opt-in per location.';
