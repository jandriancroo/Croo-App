-- Create punch clock attempts logging table
CREATE TABLE public.punch_clock_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id),
  pin_entered TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  matched_user_id UUID REFERENCES public.profiles(id),
  guessed_user_ids UUID[] DEFAULT '{}',
  guessed_user_names TEXT[] DEFAULT '{}',
  attempt_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.punch_clock_attempts ENABLE ROW LEVEL SECURITY;

-- Only admins/managers can view attempts (for debugging)
CREATE POLICY "Managers can view punch clock attempts"
ON public.punch_clock_attempts
FOR SELECT
USING (
  has_role_or_higher(auth.uid(), 'manager')
);

-- Allow inserts from authenticated users (the punch clock logs attempts)
CREATE POLICY "Authenticated users can log attempts"
ON public.punch_clock_attempts
FOR INSERT
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_punch_clock_attempts_location_time 
ON public.punch_clock_attempts(location_id, attempt_time DESC);

CREATE INDEX idx_punch_clock_attempts_pin 
ON public.punch_clock_attempts(pin_entered, location_id);