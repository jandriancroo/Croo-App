
-- Track individual task completions within nightly maintenance runs
-- Each run date can have multiple tasks, each tracked independently
CREATE TABLE public.maintenance_task_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  details JSONB DEFAULT '{}',
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_date, task_name)
);

-- Enable RLS (service-role only access)
ALTER TABLE public.maintenance_task_logs ENABLE ROW LEVEL SECURITY;

-- No public policies needed - only service role writes/reads this table
-- Add index for quick lookups by run_date
CREATE INDEX idx_maintenance_task_logs_run_date ON public.maintenance_task_logs (run_date);
