
-- Add is_draft column to schedule_change_log
ALTER TABLE public.schedule_change_log
ADD COLUMN is_draft boolean NOT NULL DEFAULT true;

-- Mark existing entries as published (they were from before this feature)
UPDATE public.schedule_change_log SET is_draft = false;

-- Add index for efficient filtering
CREATE INDEX idx_schedule_change_log_is_draft ON public.schedule_change_log(is_draft);
