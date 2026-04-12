-- Schedules table - needed for shift lookup join in punch clock
CREATE POLICY "Anon can read schedules for kiosk"
ON public.schedules
FOR SELECT
TO anon
USING (true);