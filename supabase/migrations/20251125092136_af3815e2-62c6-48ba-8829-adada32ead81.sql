-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Admins can upload profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete profile photos" ON storage.objects;

-- Allow admins to upload profile photos for any user
CREATE POLICY "Admins can upload profile photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos' AND
  has_role(auth.uid(), 'admin'::app_role)
);

-- Allow admins to update profile photos
CREATE POLICY "Admins can update profile photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-photos' AND
  has_role(auth.uid(), 'admin'::app_role)
);

-- Allow admins to delete profile photos
CREATE POLICY "Admins can delete profile photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-photos' AND
  has_role(auth.uid(), 'admin'::app_role)
);