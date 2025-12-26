-- Add column to track if push notifications should be sent for temperature alerts
ALTER TABLE public.checklist_items 
ADD COLUMN temperature_alert_enabled BOOLEAN NOT NULL DEFAULT false;