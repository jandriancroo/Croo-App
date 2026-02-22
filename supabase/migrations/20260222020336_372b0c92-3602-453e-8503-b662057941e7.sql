-- Drop and recreate with public role (matching all other working storage policies)
DROP POLICY IF EXISTS "Employees can upload i9 docs" ON storage.objects;
DROP POLICY IF EXISTS "Employees can update own i9 docs" ON storage.objects;

CREATE POLICY "Employees can upload i9 docs"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'i9-documents' 
  AND auth.role() = 'authenticated'
  AND (auth.uid())::text = split_part(name, '/', 1)
);

CREATE POLICY "Employees can update own i9 docs"
ON storage.objects FOR UPDATE
TO public
USING (
  bucket_id = 'i9-documents' 
  AND auth.role() = 'authenticated'
  AND (auth.uid())::text = split_part(name, '/', 1)
)
WITH CHECK (
  bucket_id = 'i9-documents' 
  AND auth.role() = 'authenticated'
  AND (auth.uid())::text = split_part(name, '/', 1)
);