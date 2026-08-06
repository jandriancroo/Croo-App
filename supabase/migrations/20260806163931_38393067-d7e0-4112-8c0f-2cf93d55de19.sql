CREATE POLICY "Punch device can read published schedules at its location"
ON public.schedules
FOR SELECT
TO authenticated
USING (
  public.is_punch_device(auth.uid())
  AND location_id = public.punch_device_location(auth.uid())
  AND is_published = true
);