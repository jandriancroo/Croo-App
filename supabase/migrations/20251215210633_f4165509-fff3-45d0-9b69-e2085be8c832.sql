-- Add cash handling timing and notification settings per location
ALTER TABLE public.location_settings
ADD COLUMN am_safe_count_window_minutes integer NOT NULL DEFAULT 120,
ADD COLUMN pm_safe_count_window_minutes integer NOT NULL DEFAULT 120,
ADD COLUMN drawer_count_notifications_enabled boolean NOT NULL DEFAULT true,
ADD COLUMN safe_count_notifications_enabled boolean NOT NULL DEFAULT true;