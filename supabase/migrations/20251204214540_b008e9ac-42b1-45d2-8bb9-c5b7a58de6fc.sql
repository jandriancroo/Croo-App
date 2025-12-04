-- Drop and recreate the admin upload policy to include super_admin
DROP POLICY IF EXISTS "Admins can upload certificates for any user" ON storage.objects;

CREATE POLICY "Admins can upload certificates for any user"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'certificates' AND (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);

-- Also update the view policy for admins
DROP POLICY IF EXISTS "Admins can view all certificates" ON storage.objects;

CREATE POLICY "Admins can view all certificates"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'certificates' AND (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);

-- Also update the update policy for admins
DROP POLICY IF EXISTS "Admins can update certificates" ON storage.objects;

CREATE POLICY "Admins can update certificates"
ON storage.objects
FOR UPDATE
TO public
USING (
  bucket_id = 'certificates' AND (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);

-- Also update the delete policy for admins
DROP POLICY IF EXISTS "Admins can delete certificates" ON storage.objects;

CREATE POLICY "Admins can delete certificates"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'certificates' AND (
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'super_admin'::app_role)
  )
);