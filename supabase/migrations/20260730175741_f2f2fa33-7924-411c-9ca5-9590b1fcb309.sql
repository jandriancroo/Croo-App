DROP POLICY IF EXISTS "Public can read resumes" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view resumes" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for resumes" ON storage.objects;
DROP POLICY IF EXISTS "Resumes are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Managers can read resumes" ON storage.objects;

CREATE POLICY "Managers can read resumes"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'resumes'
  AND public.has_role_or_higher(auth.uid(), 'manager')
);