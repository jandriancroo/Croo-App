-- Create table to track sent checklist notifications to prevent duplicates
CREATE TABLE IF NOT EXISTS public.checklist_notification_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- 'overdue_hourly', 'clock_in_reminder'
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  trigger_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL -- for clock-in triggers
);

-- Enable RLS
ALTER TABLE public.checklist_notification_logs ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table (used by edge functions)
CREATE POLICY "Service role only" ON public.checklist_notification_logs
  FOR ALL USING (false);

-- Index for efficient lookups
CREATE INDEX idx_checklist_notification_logs_lookup 
  ON public.checklist_notification_logs(checklist_id, location_id, notification_type, sent_at DESC);

-- Clean up old logs automatically (keep last 7 days)
CREATE INDEX idx_checklist_notification_logs_cleanup 
  ON public.checklist_notification_logs(sent_at);