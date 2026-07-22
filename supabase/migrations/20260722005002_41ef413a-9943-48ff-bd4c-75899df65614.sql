CREATE TABLE public.client_debug_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tag TEXT NOT NULL,
  user_id UUID,
  location_id UUID,
  submission_id UUID,
  item_id UUID,
  payload JSONB,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_debug_logs_tag_created ON public.client_debug_logs(tag, created_at DESC);
CREATE INDEX idx_client_debug_logs_location ON public.client_debug_logs(location_id, created_at DESC);
CREATE INDEX idx_client_debug_logs_submission ON public.client_debug_logs(submission_id);

GRANT INSERT ON public.client_debug_logs TO authenticated;
GRANT SELECT ON public.client_debug_logs TO authenticated;
GRANT ALL ON public.client_debug_logs TO service_role;

ALTER TABLE public.client_debug_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert debug logs"
  ON public.client_debug_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Super admins can read debug logs"
  ON public.client_debug_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- Auto-purge helper (called by nightly maintenance / can be invoked manually)
CREATE OR REPLACE FUNCTION public.purge_old_client_debug_logs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.client_debug_logs WHERE created_at < now() - interval '7 days';
$$;