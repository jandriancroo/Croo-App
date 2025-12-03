-- Add policy to allow punch clock inserts (PIN-based authentication)
-- The punch clock verifies users via PIN, not Supabase auth
CREATE POLICY "Allow punch clock inserts" 
ON public.time_punches 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = user_id 
    AND profiles.is_active = true
  )
);