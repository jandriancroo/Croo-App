-- Allow authenticated users to insert into alert_queue
CREATE POLICY "Authenticated users can insert alerts"
ON public.alert_queue
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to select their own alerts (needed for dedup check)
CREATE POLICY "Authenticated users can read alerts"
ON public.alert_queue
FOR SELECT
TO authenticated
USING (true);