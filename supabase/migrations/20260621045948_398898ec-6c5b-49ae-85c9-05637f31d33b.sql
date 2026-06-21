ALTER TABLE public.location_settings
  ADD COLUMN IF NOT EXISTS time_off_cutoff_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_off_cutoff_day smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS time_off_cutoff_time time without time zone NOT NULL DEFAULT '17:00:00';

ALTER TABLE public.location_settings
  ADD CONSTRAINT location_settings_time_off_cutoff_day_range
  CHECK (time_off_cutoff_day BETWEEN 0 AND 6);