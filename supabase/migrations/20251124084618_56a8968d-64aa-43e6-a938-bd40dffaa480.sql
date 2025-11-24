-- Add alert_enabled field to logbook_categories
ALTER TABLE public.logbook_categories 
ADD COLUMN alert_enabled BOOLEAN NOT NULL DEFAULT false;

-- Create storage bucket for logbook attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('logbook-attachments', 'logbook-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for logbook attachments
CREATE POLICY "Users can upload logbook attachments"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'logbook-attachments' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view logbook attachments"
ON storage.objects
FOR SELECT
USING (bucket_id = 'logbook-attachments');

CREATE POLICY "Admins can delete logbook attachments"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'logbook-attachments' AND
  has_role(auth.uid(), 'admin'::app_role)
);