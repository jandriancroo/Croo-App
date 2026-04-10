CREATE TABLE public.kds_stream_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL DEFAULT 'unknown',
  payload TEXT NOT NULL,
  headers TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No RLS needed — only service role writes
ALTER TABLE public.kds_stream_events ENABLE ROW LEVEL SECURITY;

-- Auto-cleanup: delete events older than 7 days via index for easy pruning
CREATE INDEX idx_kds_stream_events_created ON public.kds_stream_events (created_at);