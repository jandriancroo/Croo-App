
CREATE POLICY "Announcement media readable by authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'announcement-media');

CREATE POLICY "Users upload own announcement media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'announcement-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own announcement media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'announcement-media'
    AND ((storage.foldername(name))[1] = auth.uid()::text
         OR public.has_role_or_higher(auth.uid(), 'admin'))
  );

CREATE POLICY "Users delete own announcement media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'announcement-media'
    AND ((storage.foldername(name))[1] = auth.uid()::text
         OR public.has_role_or_higher(auth.uid(), 'admin'))
  );
