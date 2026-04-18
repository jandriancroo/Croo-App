
-- Idempotency log: one row per location per processed business date
CREATE TABLE public.auto_punch_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  processed_date DATE NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cron_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  punches_created INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  UNIQUE(location_id, processed_date)
);

CREATE INDEX idx_auto_punch_log_date ON public.auto_punch_log(processed_date DESC);

ALTER TABLE public.auto_punch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view auto punch log"
ON public.auto_punch_log FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin'::app_role) OR
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'org_admin'::app_role) OR
  has_role(auth.uid(), 'brand_admin'::app_role)
);

-- Audit trail: every individual auto punch-out action
CREATE TABLE public.auto_punch_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  time_punch_id UUID REFERENCES public.time_punches(id) ON DELETE SET NULL,
  clock_in_punch_id UUID REFERENCES public.time_punches(id) ON DELETE SET NULL,
  punched_out_at TIMESTAMPTZ NOT NULL,
  scheduled_shift_end TIMESTAMPTZ,
  store_close_time TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('no_schedule', 'past_scheduled_end', 'past_close_buffer')),
  shift_hours NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auto_punch_events_user ON public.auto_punch_events(user_id, created_at DESC);
CREATE INDEX idx_auto_punch_events_location ON public.auto_punch_events(location_id, created_at DESC);

ALTER TABLE public.auto_punch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view auto punch events"
ON public.auto_punch_events FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin'::app_role) OR
  has_role(auth.uid(), 'admin'::app_role) OR
  has_role(auth.uid(), 'org_admin'::app_role) OR
  has_role(auth.uid(), 'brand_admin'::app_role) OR
  has_role(auth.uid(), 'manager'::app_role)
);

CREATE POLICY "Users can view their own auto punch events"
ON public.auto_punch_events FOR SELECT
USING (auth.uid() = user_id);
