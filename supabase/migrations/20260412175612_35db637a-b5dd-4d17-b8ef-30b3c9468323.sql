-- Allow anon to read recent time punches for kiosk punch clock status checks
-- Scoped to last 24 hours only - kiosk only needs to check current shift status
CREATE POLICY "Anon can read recent punches for kiosk"
ON public.time_punches
FOR SELECT
TO anon
USING (punch_time > (now() - interval '24 hours'));