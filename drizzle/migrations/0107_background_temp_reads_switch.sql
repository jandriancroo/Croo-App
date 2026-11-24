ALTER TABLE public.location_settings ADD COLUMN background_temp_reads_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.location_settings.background_temp_reads_enabled IS 'Per-store switch: thermometer photos are read in the background on the server. Default off.';

ALTER TABLE public.checklist_responses
  ADD COLUMN temperature_read_status text CHECK (temperature_read_status IN ('reading','saved','failed')),
  ADD COLUMN temperature_read_token uuid,
  ADD COLUMN temperature_read_started_at timestamptz,
  ADD COLUMN temperature_read_reason text,
  ADD COLUMN temperature_read_coaching text,
  ADD COLUMN temperature_jump_flag boolean,
  ADD COLUMN temperature_jump_baseline numeric;