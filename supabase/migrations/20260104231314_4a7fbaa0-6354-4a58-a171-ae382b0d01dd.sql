-- Add arcade_scores preference to notification_preferences table
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS arcade_scores boolean NOT NULL DEFAULT true;