-- Create storage bucket for organization branding assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('organization-branding', 'organization-branding', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their organization's folder
CREATE POLICY "Admins can upload organization branding"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'organization-branding' AND
  public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Allow public read access
CREATE POLICY "Organization branding is publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'organization-branding');

-- Allow admins to update/delete branding
CREATE POLICY "Admins can update organization branding"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'organization-branding' AND
  public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Admins can delete organization branding"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'organization-branding' AND
  public.has_role(auth.uid(), 'admin'::public.app_role)
);