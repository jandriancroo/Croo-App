-- Allow public read access to QR-triggered tasks by their QR code
CREATE POLICY "Public can view QR tasks by code"
ON public.temporary_tasks
FOR SELECT
USING (
  is_qr_triggered = true 
  AND is_active = true 
  AND qr_code IS NOT NULL
);