
CREATE TABLE public.library_document_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.library_documents(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  editor_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_library_doc_versions_doc ON public.library_document_versions(document_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.library_document_versions TO authenticated;
GRANT ALL ON public.library_document_versions TO service_role;

ALTER TABLE public.library_document_versions ENABLE ROW LEVEL SECURITY;

-- Anyone who can read the parent document can read its versions
CREATE POLICY "Read versions when doc readable"
ON public.library_document_versions FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.library_documents d WHERE d.id = document_id)
);

-- Any authenticated user can insert snapshots (they must be editing the doc)
CREATE POLICY "Insert versions for readable docs"
ON public.library_document_versions FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.library_documents d WHERE d.id = document_id)
  AND (created_by IS NULL OR created_by = auth.uid())
);

-- Only creator or super_admin can delete a version
CREATE POLICY "Delete own versions"
ON public.library_document_versions FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);
