-- Add start and end time columns for alarm tasks
-- These define the daily time window when the alarm should be active

ALTER TABLE public.temporary_tasks 
ADD COLUMN alarm_start_time TIME DEFAULT '09:00:00',
ADD COLUMN alarm_end_time TIME DEFAULT '21:00:00';

-- Add comment for documentation
COMMENT ON COLUMN public.temporary_tasks.alarm_start_time IS 'Daily start time for alarm task triggers (local timezone)';
COMMENT ON COLUMN public.temporary_tasks.alarm_end_time IS 'Daily end time for alarm task triggers (local timezone)';