-- Create event_attendees table to track which employees are assigned to events (meetings)
CREATE TABLE public.event_attendees (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.schedule_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  UNIQUE(event_id, user_id)
);

-- Enable Row Level Security
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

-- Policies for event_attendees
CREATE POLICY "Users can view events they're assigned to"
ON public.event_attendees
FOR SELECT
USING (
  auth.uid() = user_id OR
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager', 'super_admin', 'org_admin')
  )
);

CREATE POLICY "Admins and managers can manage event attendees"
ON public.event_attendees
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'manager', 'super_admin', 'org_admin')
  )
);

-- Add is_meeting flag to schedule_events to identify punch-clock-eligible events
ALTER TABLE public.schedule_events 
ADD COLUMN IF NOT EXISTS is_meeting BOOLEAN NOT NULL DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.schedule_events.is_meeting IS 'When true, attendees can punch in during event time window regardless of their scheduled shift';

-- Index for efficient lookups
CREATE INDEX idx_event_attendees_user_id ON public.event_attendees(user_id);
CREATE INDEX idx_event_attendees_event_id ON public.event_attendees(event_id);
CREATE INDEX idx_schedule_events_meeting ON public.schedule_events(is_meeting) WHERE is_meeting = true;