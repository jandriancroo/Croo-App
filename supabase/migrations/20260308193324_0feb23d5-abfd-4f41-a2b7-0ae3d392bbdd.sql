ALTER TABLE public.location_settings 
  ADD COLUMN inventory_period_end_day integer NOT NULL DEFAULT 0,
  ADD COLUMN inventory_period_cutoff text NOT NULL DEFAULT 'after_close';

COMMENT ON COLUMN public.location_settings.inventory_period_end_day IS 'Day of week (0=Sun, 1=Mon, ..., 6=Sat) when inventory period ends';
COMMENT ON COLUMN public.location_settings.inventory_period_cutoff IS 'When period closes: after_close (includes end day sales) or before_open (end day starts next period)';