-- Secure the resumes storage bucket to require authentication
-- Drop public INSERT policy if it exists
DROP POLICY IF EXISTS "Allow public uploads" ON storage.objects;

-- Create authenticated-only INSERT policy
CREATE POLICY "Only authenticated users can upload resumes"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create SELECT policy for users to access their own resumes
CREATE POLICY "Users can view their own resumes"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create UPDATE policy for users to update their own resumes
CREATE POLICY "Users can update their own resumes"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create DELETE policy for users to delete their own resumes
CREATE POLICY "Users can delete their own resumes"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);