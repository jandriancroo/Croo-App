ALTER TABLE public.punch_clock_devices
  ADD COLUMN IF NOT EXISTS device_secret_hash text,
  ADD COLUMN IF NOT EXISTS device_secret_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reissue_at timestamptz,
  ADD COLUMN IF NOT EXISTS reissue_window_start timestamptz,
  ADD COLUMN IF NOT EXISTS reissue_count_in_window integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_punch_clock_devices_secret_hash
  ON public.punch_clock_devices (device_secret_hash)
  WHERE device_secret_hash IS NOT NULL;