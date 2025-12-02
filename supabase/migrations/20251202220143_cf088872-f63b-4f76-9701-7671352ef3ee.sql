-- Add new notification preference columns
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS schedule_updates boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS shift_approvals boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS certification_expiring boolean NOT NULL DEFAULT true;