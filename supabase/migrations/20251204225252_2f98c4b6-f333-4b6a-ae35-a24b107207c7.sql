-- Create table to track user notification preferences per location
CREATE TABLE public.user_location_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    notifications_enabled boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (user_id, location_id)
);

-- Enable RLS
ALTER TABLE public.user_location_notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notification preferences
CREATE POLICY "Users can view own notification preferences"
ON public.user_location_notifications
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own notification preferences
CREATE POLICY "Users can insert own notification preferences"
ON public.user_location_notifications
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own notification preferences
CREATE POLICY "Users can update own notification preferences"
ON public.user_location_notifications
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own notification preferences
CREATE POLICY "Users can delete own notification preferences"
ON public.user_location_notifications
FOR DELETE
USING (auth.uid() = user_id);

-- Add index for faster lookups
CREATE INDEX idx_user_location_notifications_user_id ON public.user_location_notifications(user_id);
CREATE INDEX idx_user_location_notifications_location_id ON public.user_location_notifications(location_id);