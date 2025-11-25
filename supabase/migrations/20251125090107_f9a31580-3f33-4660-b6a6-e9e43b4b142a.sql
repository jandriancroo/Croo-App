-- Create location_settings table for location-specific configuration
CREATE TABLE public.location_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  hours_open TIME,
  hours_close TIME,
  blackout_dates DATE[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(location_id)
);

-- Enable RLS
ALTER TABLE public.location_settings ENABLE ROW LEVEL SECURITY;

-- Admins can manage location settings
CREATE POLICY "Admins can manage location settings"
ON public.location_settings
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Users can view settings for their assigned locations
CREATE POLICY "Users can view location settings"
ON public.location_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_locations
    WHERE user_locations.location_id = location_settings.location_id
    AND user_locations.user_id = auth.uid()
  )
);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_location_settings_updated_at
BEFORE UPDATE ON public.location_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();