-- Add column to track if shift was trimmed by auto-scheduler
ALTER TABLE public.scheduled_shifts 
ADD COLUMN IF NOT EXISTS was_trimmed boolean DEFAULT false;

-- Add column to store original end time before trimming
ALTER TABLE public.scheduled_shifts 
ADD COLUMN IF NOT EXISTS original_end_time time without time zone;