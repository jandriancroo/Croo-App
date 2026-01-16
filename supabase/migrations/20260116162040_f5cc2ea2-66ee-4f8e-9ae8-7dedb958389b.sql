-- Create table to track sent daily summaries (prevents duplicates)
CREATE TABLE public.daily_summary_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recipient_count INTEGER,
  UNIQUE(location_id, summary_date)
);

-- Enable RLS
ALTER TABLE public.daily_summary_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view logs
CREATE POLICY "Authenticated users can view summary logs"
ON public.daily_summary_logs
FOR SELECT
TO authenticated
USING (true);

-- Allow service role to insert (edge function)
CREATE POLICY "Service role can insert summary logs"
ON public.daily_summary_logs
FOR INSERT
TO authenticated
WITH CHECK (true);