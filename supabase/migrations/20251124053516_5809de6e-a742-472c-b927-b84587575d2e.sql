-- Add is_recurring field to schedule_events table
ALTER TABLE public.schedule_events
ADD COLUMN is_recurring boolean NOT NULL DEFAULT true;