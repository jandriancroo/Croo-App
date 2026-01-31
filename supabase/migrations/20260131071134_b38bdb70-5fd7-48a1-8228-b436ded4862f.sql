-- Add event_end_time and event_date columns to schedule_events table
ALTER TABLE public.schedule_events 
ADD COLUMN IF NOT EXISTS event_end_time TIME WITHOUT TIME ZONE,
ADD COLUMN IF NOT EXISTS event_date DATE;