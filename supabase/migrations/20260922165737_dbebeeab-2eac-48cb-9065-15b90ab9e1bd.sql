CREATE TABLE IF NOT EXISTS public.application_notify_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  channel text NOT NULL,
  recipient text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_notify_log_unique UNIQUE (application_id, channel, recipient)
);

CREATE INDEX IF NOT EXISTS idx_application_notify_log_application
  ON public.application_notify_log (application_id);

GRANT ALL ON public.application_notify_log TO service_role;

ALTER TABLE public.application_notify_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view application notify log" ON public.application_notify_log;
CREATE POLICY "Admins can view application notify log"
ON public.application_notify_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));