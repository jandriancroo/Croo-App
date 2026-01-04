-- Change arcade_scores default to false (opt-in instead of opt-out)
ALTER TABLE public.notification_preferences 
ALTER COLUMN arcade_scores SET DEFAULT false;