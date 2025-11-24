-- Add employee_pin to profiles table
ALTER TABLE public.profiles 
ADD COLUMN employee_pin TEXT UNIQUE;

-- Add comment explaining the column
COMMENT ON COLUMN public.profiles.employee_pin IS '4-digit PIN for punch clock, must be unique';

-- Create time_punches table for tracking clock in/out
CREATE TABLE public.time_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.scheduled_shifts(id) ON DELETE SET NULL,
  punch_type TEXT NOT NULL CHECK (punch_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
  punch_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.time_punches ENABLE ROW LEVEL SECURITY;

-- Users can view their own punches
CREATE POLICY "Users can view own time punches"
ON public.time_punches
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own punches
CREATE POLICY "Users can create own time punches"
ON public.time_punches
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Admins and managers can view all punches
CREATE POLICY "Admins and managers can view all time punches"
ON public.time_punches
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

-- Admins and managers can update time punches
CREATE POLICY "Admins and managers can update time punches"
ON public.time_punches
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

-- Admins and managers can delete time punches
CREATE POLICY "Admins and managers can delete time punches"
ON public.time_punches
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

-- Create index for faster queries
CREATE INDEX idx_time_punches_user_id ON public.time_punches(user_id);
CREATE INDEX idx_time_punches_shift_id ON public.time_punches(shift_id);
CREATE INDEX idx_time_punches_punch_time ON public.time_punches(punch_time);

-- Add function to generate unique 4-digit PIN
CREATE OR REPLACE FUNCTION public.generate_unique_pin()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_pin TEXT;
  pin_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate random 4-digit number
    new_pin := LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    
    -- Check if PIN already exists
    SELECT EXISTS(SELECT 1 FROM profiles WHERE employee_pin = new_pin) INTO pin_exists;
    
    -- Exit loop if PIN is unique
    EXIT WHEN NOT pin_exists;
  END LOOP;
  
  RETURN new_pin;
END;
$$;