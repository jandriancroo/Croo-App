-- Allow admins to upload certificates for any user
CREATE POLICY "Admins can upload certificates for any user"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'certificates' AND 
  has_role(auth.uid(), 'admin'::app_role)
);

-- Allow admins to update certificates for any user
CREATE POLICY "Admins can update certificates"
ON storage.objects
FOR UPDATE
TO public
USING (
  bucket_id = 'certificates' AND 
  has_role(auth.uid(), 'admin'::app_role)
);

-- Allow admins to delete certificates for any user  
CREATE POLICY "Admins can delete certificates"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'certificates' AND 
  has_role(auth.uid(), 'admin'::app_role)
);