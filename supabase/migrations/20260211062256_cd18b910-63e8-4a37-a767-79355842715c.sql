
-- Email queue table for reliable email delivery with retries
CREATE TABLE public.email_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Email content
  from_address TEXT NOT NULL DEFAULT 'CrooHQ <hello@croohq.email>',
  to_addresses TEXT[] NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  
  -- Delivery tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  
  -- Retry logic
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  
  -- Deduplication
  dedup_key TEXT,
  
  -- Context for debugging
  source TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Index for the sender to poll efficiently
CREATE INDEX idx_email_queue_pending ON public.email_queue (created_at ASC) 
  WHERE status = 'pending' AND retry_count < 3;

-- Unique constraint for deduplication
CREATE UNIQUE INDEX idx_email_queue_dedup ON public.email_queue (dedup_key) 
  WHERE dedup_key IS NOT NULL;

-- Index for cleanup queries
CREATE INDEX idx_email_queue_status_created ON public.email_queue (status, created_at);

-- Enable RLS
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (no client access needed)
-- No policies = no client access, which is correct for a backend-only table
