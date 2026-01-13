-- Allow authenticated users to upload write-up signatures to logbook-attachments
CREATE POLICY "Employees can upload writeup signatures"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'logbook-attachments' 
  AND (storage.foldername(name))[1] = 'writeup-signatures'
);

-- Allow authenticated users to view write-up signatures
CREATE POLICY "Employees can view writeup signatures"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'logbook-attachments' 
  AND (storage.foldername(name))[1] = 'writeup-signatures'
);