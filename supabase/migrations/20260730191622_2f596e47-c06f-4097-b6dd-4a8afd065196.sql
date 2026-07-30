DROP POLICY IF EXISTS "Anyone can view audits" ON storage.objects;
CREATE POLICY "Signed-in users can view food safety audits"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'food-safety-audits');

DROP POLICY IF EXISTS "Users can view logbook attachments" ON storage.objects;
CREATE POLICY "Signed-in users can view logbook attachments"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'logbook-attachments');

DROP POLICY IF EXISTS "waste_photos_public_select" ON storage.objects;
CREATE POLICY "Signed-in users can view waste photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'waste-photos');