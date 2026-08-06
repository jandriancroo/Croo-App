DROP POLICY IF EXISTS "Anon can read scheduled shifts for kiosk" ON public.scheduled_shifts;
CREATE POLICY "Anon can read scheduled shifts for kiosk"
ON public.scheduled_shifts
FOR SELECT
TO anon
USING (shift_date >= (CURRENT_DATE - 2) AND shift_date <= (CURRENT_DATE + 1));