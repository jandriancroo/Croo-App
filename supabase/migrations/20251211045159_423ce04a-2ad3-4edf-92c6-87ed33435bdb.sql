-- Create storage bucket for resumes
INSERT INTO storage.buckets (id, name, public) VALUES ('resumes', 'resumes', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for resumes
CREATE POLICY "Anyone can upload resumes"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'resumes');

CREATE POLICY "Org admins can view resumes"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'resumes'
  AND (
    auth.uid() IS NOT NULL
    AND (
      is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.user_id = auth.uid()
        AND om.org_role = 'admin'
      )
    )
  )
);