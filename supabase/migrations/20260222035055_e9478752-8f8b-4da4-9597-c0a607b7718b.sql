-- Employees need SELECT on their own i9-documents files for upsert to work
CREATE POLICY "Employees can read own i9 docs"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'i9-documents'
  AND auth.role() = 'authenticated'
  AND (auth.uid())::text = split_part(name, '/', 1)
);
