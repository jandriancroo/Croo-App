-- Step 1: Add new columns to email_queue for the simplified pipeline
ALTER TABLE public.email_queue 
  ADD COLUMN IF NOT EXISTS email_type TEXT,
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id),
  ADD COLUMN IF NOT EXISTS target_date DATE;

-- Step 2: Create index for the batch sender to efficiently pick up pending emails
CREATE INDEX IF NOT EXISTS idx_email_queue_pending 
  ON public.email_queue (status, created_at) 
  WHERE status = 'pending';

-- Step 3: Create index for simple dedup lookups (location + date + type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_queue_dedup_simple
  ON public.email_queue (email_type, location_id, target_date)
  WHERE email_type IS NOT NULL 
    AND location_id IS NOT NULL 
    AND target_date IS NOT NULL
    AND source != 'test_preview';