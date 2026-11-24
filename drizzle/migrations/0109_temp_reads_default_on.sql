ALTER TABLE public.location_settings ADD COLUMN IF NOT EXISTS digital_orient_reads_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.location_settings ALTER COLUMN background_temp_reads_enabled SET DEFAULT true;
UPDATE public.location_settings SET background_temp_reads_enabled = true;
ALTER TABLE public.location_settings ALTER COLUMN digital_orient_reads_enabled SET DEFAULT true;
UPDATE public.location_settings SET digital_orient_reads_enabled = true;