-- Add show_on_punch_clock column for alarm tasks
ALTER TABLE public.temporary_tasks 
ADD COLUMN show_on_punch_clock boolean DEFAULT false;