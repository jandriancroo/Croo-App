-- Add show_on_dashboard column to temporary_tasks table
-- Defaults to true so existing tasks continue showing on dashboard
ALTER TABLE public.temporary_tasks 
ADD COLUMN IF NOT EXISTS show_on_dashboard boolean NOT NULL DEFAULT true;