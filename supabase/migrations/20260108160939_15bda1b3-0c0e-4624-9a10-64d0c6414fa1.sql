-- Add support_tickets notification preference column
ALTER TABLE public.notification_preferences
ADD COLUMN IF NOT EXISTS support_tickets boolean DEFAULT true;

-- Add comment
COMMENT ON COLUMN public.notification_preferences.support_tickets IS 'Receive notifications for new support tickets and messages';