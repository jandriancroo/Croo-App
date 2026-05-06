
INSERT INTO storage.buckets (id, name, public) VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org admins can read reports"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'reports' AND public.has_role_or_higher(auth.uid(), 'org_admin'));

CREATE POLICY "Org admins can upload reports"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'reports' AND public.has_role_or_higher(auth.uid(), 'org_admin'));

CREATE POLICY "Org admins can delete reports"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'reports' AND public.has_role_or_higher(auth.uid(), 'org_admin'));
