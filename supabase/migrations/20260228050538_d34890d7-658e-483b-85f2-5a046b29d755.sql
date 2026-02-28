
-- Add days_of_week to temporary_task_subtasks for day-specific subtask visibility
-- Uses Monday-start indexing (0=Mon, 6=Sun) consistent with system convention
ALTER TABLE public.temporary_task_subtasks 
ADD COLUMN IF NOT EXISTS days_of_week integer[] DEFAULT NULL;

-- Add quantity field for prep-style subtasks (e.g., "Pineapple QTY 2")
ALTER TABLE public.temporary_task_subtasks
ADD COLUMN IF NOT EXISTS quantity integer DEFAULT NULL;

-- Add show_on_punch_clock to temporary_tasks (auto-true for team tasks)
ALTER TABLE public.temporary_tasks
ADD COLUMN IF NOT EXISTS show_on_punch_clock boolean NOT NULL DEFAULT false;

-- Create task_subtask_completions for tracking who completed each subtask per day
CREATE TABLE IF NOT EXISTS public.task_subtask_completions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subtask_id uuid NOT NULL REFERENCES public.temporary_task_subtasks(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.temporary_tasks(id) ON DELETE CASCADE,
  completed_by uuid NOT NULL REFERENCES public.profiles(id),
  completed_date date NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subtask_id, completed_date)
);

-- Enable RLS
ALTER TABLE public.task_subtask_completions ENABLE ROW LEVEL SECURITY;

-- RLS: Authenticated users at the task's location can read completions
CREATE POLICY "Users can view completions for their location tasks"
ON public.task_subtask_completions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.temporary_tasks t
    JOIN public.user_locations ul ON ul.location_id = t.location_id
    WHERE t.id = task_subtask_completions.task_id
      AND ul.user_id = auth.uid()
  )
);

-- RLS: Authenticated users at the location can insert completions
CREATE POLICY "Users can complete subtasks at their location"
ON public.task_subtask_completions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.temporary_tasks t
    JOIN public.user_locations ul ON ul.location_id = t.location_id
    WHERE t.id = task_subtask_completions.task_id
      AND ul.user_id = auth.uid()
  )
);

-- RLS: Allow deletion (for undo/reset scenarios) by location members
CREATE POLICY "Users can delete completions at their location"
ON public.task_subtask_completions
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.temporary_tasks t
    JOIN public.user_locations ul ON ul.location_id = t.location_id
    WHERE t.id = task_subtask_completions.task_id
      AND ul.user_id = auth.uid()
  )
);

-- Index for fast lookups by date
CREATE INDEX IF NOT EXISTS idx_subtask_completions_date 
ON public.task_subtask_completions(task_id, completed_date);

CREATE INDEX IF NOT EXISTS idx_subtask_completions_subtask 
ON public.task_subtask_completions(subtask_id, completed_date);
