-- Add slide_duration column to punch_clock_templates (in seconds, default 10)
ALTER TABLE public.punch_clock_templates 
ADD COLUMN slide_duration integer DEFAULT 10;