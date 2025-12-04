-- Drop existing simple table and recreate with granular notification types per location
DROP TABLE IF EXISTS public.user_location_notifications;

CREATE TABLE public.user_location_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id, notification_type)
);

-- Enable RLS
ALTER TABLE public.user_location_notifications ENABLE ROW LEVEL SECURITY;

-- Users can manage their own location notification preferences
CREATE POLICY "Users can view their own location notification prefs"
ON public.user_location_notifications
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own location notification prefs"
ON public.user_location_notifications
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own location notification prefs"
ON public.user_location_notifications
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own location notification prefs"
ON public.user_location_notifications
FOR DELETE
USING (auth.uid() = user_id);