-- Add push notification toggle for logbook categories
ALTER TABLE public.logbook_categories 
ADD COLUMN push_notification_enabled boolean NOT NULL DEFAULT false;