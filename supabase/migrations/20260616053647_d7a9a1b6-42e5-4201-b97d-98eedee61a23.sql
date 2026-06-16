CREATE TYPE public.visual_alert_type AS ENUM ('quick_task', 'overdue_checklist');

CREATE TABLE public.visual_alert_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  alert_type public.visual_alert_type NOT NULL,
  ref_id UUID NOT NULL,
  notification_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  location_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  CONSTRAINT visual_alert_queue_unique_per_notification UNIQUE (user_id, notification_id)
);

CREATE INDEX idx_visual_alert_queue_user_unseen
  ON public.visual_alert_queue (user_id, created_at DESC)
  WHERE seen_at IS NULL;

GRANT SELECT, UPDATE ON public.visual_alert_queue TO authenticated;
GRANT ALL ON public.visual_alert_queue TO service_role;

ALTER TABLE public.visual_alert_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own visual alerts"
  ON public.visual_alert_queue FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users update own visual alerts"
  ON public.visual_alert_queue FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.visual_alert_queue;
ALTER TABLE public.visual_alert_queue REPLICA IDENTITY FULL;

-- Prune function: remove expired or long-seen rows
CREATE OR REPLACE FUNCTION public.prune_visual_alert_queue()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.visual_alert_queue
  WHERE expires_at < now()
     OR (seen_at IS NOT NULL AND seen_at < now() - INTERVAL '24 hours');
$$;