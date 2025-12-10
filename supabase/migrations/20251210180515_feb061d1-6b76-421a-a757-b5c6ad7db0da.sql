-- Create table for per-day business hours
CREATE TABLE public.location_hours (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  open_time TIME WITHOUT TIME ZONE,
  close_time TIME WITHOUT TIME ZONE,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(location_id, day_of_week)
);

-- Enable RLS
ALTER TABLE public.location_hours ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can manage location hours"
ON public.location_hours
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view location hours for their locations"
ON public.location_hours
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM user_locations
  WHERE user_locations.location_id = location_hours.location_id
  AND user_locations.user_id = auth.uid()
));

-- Migrate existing hours_open/hours_close to new table (apply to all days)
INSERT INTO public.location_hours (location_id, day_of_week, open_time, close_time, is_closed)
SELECT 
  ls.location_id,
  d.day,
  ls.hours_open,
  ls.hours_close,
  false
FROM location_settings ls
CROSS JOIN generate_series(0, 6) AS d(day)
WHERE ls.hours_open IS NOT NULL OR ls.hours_close IS NOT NULL
ON CONFLICT (location_id, day_of_week) DO NOTHING;