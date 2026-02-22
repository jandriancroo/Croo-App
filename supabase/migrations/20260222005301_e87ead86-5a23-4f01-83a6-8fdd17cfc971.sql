
-- ============================================
-- I-9 Document Request & Audit System
-- ============================================

-- Document type enum
CREATE TYPE public.i9_document_type AS ENUM ('photo_id', 'ssn_card', 'work_authorization', 'passport');

-- Request status enum  
CREATE TYPE public.i9_request_status AS ENUM ('pending', 'uploaded', 'retrieved', 'expired');

-- ============================================
-- I-9 Document Requests table
-- ============================================
CREATE TABLE public.i9_document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  document_types i9_document_type[] NOT NULL,
  status i9_request_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days')
);

ALTER TABLE public.i9_document_requests ENABLE ROW LEVEL SECURITY;

-- Admins+ at same location can view/manage requests
CREATE POLICY "Admins can manage i9 requests"
  ON public.i9_document_requests
  FOR ALL
  USING (
    has_location_access(auth.uid(), location_id)
    AND has_role_or_higher(auth.uid(), 'admin')
  );

-- Employees can see their own requests
CREATE POLICY "Employees can view own i9 requests"
  ON public.i9_document_requests
  FOR SELECT
  USING (auth.uid() = employee_id);

-- ============================================
-- I-9 Uploaded Documents (metadata only - files in storage)
-- ============================================
CREATE TABLE public.i9_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.i9_document_requests(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  document_type i9_document_type NOT NULL,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retrieved_at TIMESTAMPTZ,
  retrieved_by UUID REFERENCES public.profiles(id),
  deleted_at TIMESTAMPTZ
);

ALTER TABLE public.i9_documents ENABLE ROW LEVEL SECURITY;

-- Admins+ at request location can view documents
CREATE POLICY "Admins can view i9 documents"
  ON public.i9_documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.i9_document_requests r
      WHERE r.id = request_id
        AND has_location_access(auth.uid(), r.location_id)
        AND has_role_or_higher(auth.uid(), 'admin')
    )
  );

-- Employees can insert their own documents
CREATE POLICY "Employees can upload own i9 documents"
  ON public.i9_documents
  FOR INSERT
  WITH CHECK (auth.uid() = employee_id);

-- Admins can update (mark retrieved/deleted)
CREATE POLICY "Admins can update i9 documents"
  ON public.i9_documents
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.i9_document_requests r
      WHERE r.id = request_id
        AND has_location_access(auth.uid(), r.location_id)
        AND has_role_or_higher(auth.uid(), 'admin')
    )
  );

-- ============================================
-- I-9 Audit Log (permanent record, no file content)
-- ============================================
CREATE TABLE public.i9_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES public.i9_document_requests(id),
  employee_id UUID NOT NULL REFERENCES public.profiles(id),
  location_id UUID NOT NULL REFERENCES public.locations(id),
  action TEXT NOT NULL, -- 'requested', 'uploaded', 'retrieved', 'deleted', 'expired'
  document_type i9_document_type,
  performed_by UUID NOT NULL REFERENCES public.profiles(id),
  performed_by_name TEXT,
  employee_name TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.i9_audit_log ENABLE ROW LEVEL SECURITY;

-- Only super_admin can view audit logs
CREATE POLICY "Super admins can view i9 audit logs"
  ON public.i9_audit_log
  FOR SELECT
  USING (is_super_admin(auth.uid()));

-- System inserts via security definer function
CREATE POLICY "Authenticated users can insert audit logs"
  ON public.i9_audit_log
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- Storage bucket for I-9 documents (private)
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('i9-documents', 'i9-documents', false);

-- Only employees can upload to their own folder
CREATE POLICY "Employees can upload i9 docs"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'i9-documents'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Only admins+ can read/download
CREATE POLICY "Admins can read i9 docs"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'i9-documents'
    AND has_role_or_higher(auth.uid(), 'admin')
  );

-- Admins can delete after retrieval
CREATE POLICY "Admins can delete i9 docs"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'i9-documents'
    AND has_role_or_higher(auth.uid(), 'admin')
  );

-- ============================================
-- Triggers
-- ============================================
CREATE TRIGGER update_i9_requests_updated_at
  BEFORE UPDATE ON public.i9_document_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-log when request is created
CREATE OR REPLACE FUNCTION public.log_i9_request_created()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_employee_name TEXT;
  v_requester_name TEXT;
BEGIN
  SELECT full_name INTO v_employee_name FROM profiles WHERE id = NEW.employee_id;
  SELECT full_name INTO v_requester_name FROM profiles WHERE id = NEW.requested_by;
  
  INSERT INTO i9_audit_log (request_id, employee_id, location_id, action, performed_by, performed_by_name, employee_name, metadata)
  VALUES (
    NEW.id, NEW.employee_id, NEW.location_id, 'requested',
    NEW.requested_by, v_requester_name, v_employee_name,
    jsonb_build_object('document_types', to_jsonb(NEW.document_types))
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER i9_request_audit_insert
  AFTER INSERT ON public.i9_document_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.log_i9_request_created();
