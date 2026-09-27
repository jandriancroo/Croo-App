DROP POLICY "Authenticated users can view invoices" ON storage.objects;
DROP POLICY "Authenticated users can upload invoices" ON storage.objects;
CREATE POLICY "vendor_invoices_select_own_locations" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vendor-invoices' AND (
    CASE WHEN (storage.foldername(name))[1] = 'lite' THEN
           CASE WHEN (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN public.has_location_access(auth.uid(), ((storage.foldername(name))[2])::uuid) ELSE false END
         WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN public.has_location_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
         ELSE false END));
CREATE POLICY "vendor_invoices_insert_own_locations" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-invoices' AND (
    CASE WHEN (storage.foldername(name))[1] = 'lite' THEN
           CASE WHEN (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN public.has_location_access(auth.uid(), ((storage.foldername(name))[2])::uuid) ELSE false END
         WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN public.has_location_access(auth.uid(), ((storage.foldername(name))[1])::uuid)
         ELSE false END));