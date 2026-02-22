-- Drop the existing INSERT policy that uses foldername (may have edge case issues)
DROP POLICY IF EXISTS "Employees can upload i9 docs" ON storage.objects;

-- Recreate with a simpler, more reliable check using starts_with
CREATE POLICY "Employees can upload i9 docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'i9-documents' 
  AND (auth.uid())::text = split_part(name, '/', 1)
);

-- Also fix the UPDATE policy to match
DROP POLICY IF EXISTS "Employees can update own i9 docs" ON storage.objects;

CREATE POLICY "Employees can update own i9 docs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'i9-documents' 
  AND (auth.uid())::text = split_part(name, '/', 1)
)
WITH CHECK (
  bucket_id = 'i9-documents' 
  AND (auth.uid())::text = split_part(name, '/', 1)
);