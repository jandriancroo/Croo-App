CREATE POLICY "Brand admins can insert gap alerts"
ON public.vendor_gap_alerts
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM brand_members bm
    WHERE bm.brand_id = vendor_gap_alerts.brand_id
    AND bm.user_id = auth.uid()
  )
);