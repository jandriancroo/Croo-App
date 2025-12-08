-- Drop existing policies if they exist and recreate them
DROP POLICY IF EXISTS "Users can view own certificates" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own certificates" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete certificates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view checklist images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload checklist images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can view food safety audits" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload food safety audits" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete food safety audits" ON storage.objects;
DROP POLICY IF EXISTS "Chat members can view message attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload message attachments" ON storage.objects;

-- Re-create with proper access control
CREATE POLICY "Users can view own certificates"
ON storage.objects FOR SELECT
USING (bucket_id = 'certificates' AND (
  auth.uid()::text = (storage.foldername(name))[1] OR
  has_role(auth.uid(), 'admin'::app_role)
));

CREATE POLICY "Users can upload own certificates"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'certificates' AND (
  auth.uid()::text = (storage.foldername(name))[1] OR
  has_role(auth.uid(), 'admin'::app_role)
));

CREATE POLICY "Admins can delete certificates"
ON storage.objects FOR DELETE
USING (bucket_id = 'certificates' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can view checklist images"
ON storage.objects FOR SELECT
USING (bucket_id = 'checklist-images' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload checklist images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'checklist-images' AND auth.role() = 'authenticated');

CREATE POLICY "Admins can view food safety audits"
ON storage.objects FOR SELECT
USING (bucket_id = 'food-safety-audits' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can upload food safety audits"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'food-safety-audits' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete food safety audits"
ON storage.objects FOR DELETE
USING (bucket_id = 'food-safety-audits' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Chat members can view message attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'message-attachments' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload message attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'message-attachments' AND auth.role() = 'authenticated');