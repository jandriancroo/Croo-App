
-- Table to store daily CrooAI morning briefings per location
CREATE TABLE public.croo_ai_briefings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  briefing_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, briefing_date)
);

-- Enable RLS
ALTER TABLE public.croo_ai_briefings ENABLE ROW LEVEL SECURITY;

-- Users can read briefings for their locations
CREATE POLICY "Users can read briefings for their locations"
ON public.croo_ai_briefings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
    AND ul.location_id = croo_ai_briefings.location_id
  )
);

-- Service role can insert (from edge function)
CREATE POLICY "Service role can insert briefings"
ON public.croo_ai_briefings
FOR INSERT
WITH CHECK (true);

-- Table to track which users have read the daily briefing
CREATE TABLE public.croo_ai_briefing_reads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  briefing_id UUID NOT NULL REFERENCES public.croo_ai_briefings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (briefing_id, user_id)
);

ALTER TABLE public.croo_ai_briefing_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own read status"
ON public.croo_ai_briefing_reads
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can mark briefings as read"
ON public.croo_ai_briefing_reads
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Index for fast lookups
CREATE INDEX idx_croo_ai_briefings_location_date ON public.croo_ai_briefings(location_id, briefing_date);
CREATE INDEX idx_croo_ai_briefing_reads_user ON public.croo_ai_briefing_reads(user_id, briefing_id);
