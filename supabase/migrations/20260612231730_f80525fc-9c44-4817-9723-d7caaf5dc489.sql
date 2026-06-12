
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS shift_reminders BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.shift_reminder_log (
  shift_id UUID PRIMARY KEY REFERENCES public.scheduled_shifts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shift_reminder_log TO authenticated;
GRANT ALL ON public.shift_reminder_log TO service_role;

ALTER TABLE public.shift_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own reminder log"
  ON public.shift_reminder_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
