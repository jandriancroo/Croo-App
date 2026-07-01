
CREATE POLICY "auth read library-assets"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'library-assets');

CREATE POLICY "editors write library-assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'library-assets' AND (
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'brand_admin'::app_role) OR
    public.has_role(auth.uid(),'org_admin'::app_role)
  )
);

CREATE POLICY "editors update library-assets"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'library-assets' AND (
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'brand_admin'::app_role) OR
    public.has_role(auth.uid(),'org_admin'::app_role)
  )
);

CREATE POLICY "editors delete library-assets"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'library-assets' AND (
    public.has_role(auth.uid(),'super_admin'::app_role) OR
    public.has_role(auth.uid(),'brand_admin'::app_role) OR
    public.has_role(auth.uid(),'org_admin'::app_role)
  )
);
