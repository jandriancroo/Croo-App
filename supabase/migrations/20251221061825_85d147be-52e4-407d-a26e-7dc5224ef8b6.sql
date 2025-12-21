-- Add alarm task columns to temporary_tasks
ALTER TABLE public.temporary_tasks
ADD COLUMN IF NOT EXISTS task_style TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS days_of_week INTEGER[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS frequency_type TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS frequency_minutes INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS custom_times TEXT[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS notify_only_working BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ DEFAULT NULL;

-- Create table to track alarm task completions per interval
CREATE TABLE IF NOT EXISTS public.alarm_task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.temporary_tasks(id) ON DELETE CASCADE,
  completed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  interval_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.alarm_task_completions ENABLE ROW LEVEL SECURITY;

-- RLS policies for alarm_task_completions
CREATE POLICY "Users can view alarm completions for their location"
ON public.alarm_task_completions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    JOIN public.user_locations ul ON ul.location_id = tt.location_id
    WHERE tt.id = alarm_task_completions.task_id
    AND ul.user_id = auth.uid()
  )
);

CREATE POLICY "Authenticated users can insert alarm completions"
ON public.alarm_task_completions
FOR INSERT
WITH CHECK (auth.uid() = completed_by);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_alarm_task_completions_task_interval 
ON public.alarm_task_completions(task_id, interval_key);

CREATE INDEX IF NOT EXISTS idx_temporary_tasks_alarm 
ON public.temporary_tasks(task_style, is_active) 
WHERE task_style = 'alarm' AND is_active = true;