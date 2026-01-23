-- Allow public read of location name/org for QR task display
CREATE POLICY "Public can view locations for QR tasks"
ON public.locations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    WHERE tt.location_id = locations.id
      AND tt.is_qr_triggered = true
      AND tt.is_active = true
      AND tt.qr_code IS NOT NULL
  )
);

-- Also need to allow organizations to be read for branding
CREATE POLICY "Public can view organizations for QR tasks"
ON public.organizations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.locations l
    JOIN public.temporary_tasks tt ON tt.location_id = l.id
    WHERE l.organization_id = organizations.id
      AND tt.is_qr_triggered = true
      AND tt.is_active = true
      AND tt.qr_code IS NOT NULL
  )
);