CREATE POLICY "Employees can update own i9 docs"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'i9-documents' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'i9-documents' AND (auth.uid())::text = (storage.foldername(name))[1]);