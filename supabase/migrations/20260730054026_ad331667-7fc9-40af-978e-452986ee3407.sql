-- ============ 1. job_applications: kill anon full read ============
DROP POLICY IF EXISTS "Anon can read back own application" ON public.job_applications;
DROP POLICY IF EXISTS "Applicants can view own applications by email" ON public.job_applications;

-- Narrow, non-PII status lookup for the public applicant portal.
CREATE OR REPLACE FUNCTION public.get_applications_by_email(_email text)
RETURNS TABLE (
  id uuid,
  full_name text,
  status application_status,
  submitted_at timestamptz,
  organization_name text,
  organization_brand_name text,
  organization_logo_url text,
  location_name text,
  conversation_access_token text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ja.id,
    ja.full_name,
    ja.status,
    ja.submitted_at,
    o.name,
    o.brand_name,
    o.logo_url,
    l.name,
    (SELECT hc.access_token FROM public.hiring_conversations hc
      WHERE hc.application_id = ja.id ORDER BY hc.created_at DESC LIMIT 1)
  FROM public.job_applications ja
  LEFT JOIN public.organizations o ON o.id = ja.organization_id
  LEFT JOIN public.locations l ON l.id = ja.location_id
  WHERE _email IS NOT NULL
    AND length(btrim(_email)) > 3
    AND lower(ja.email) = lower(btrim(_email))
  ORDER BY ja.submitted_at DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION public.get_applications_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_applications_by_email(text) TO anon, authenticated;

-- ============ 2. application child rows: only attach to a fresh application ============
DROP POLICY IF EXISTS "Anyone can insert references" ON public.job_application_references;
DROP POLICY IF EXISTS "Anyone can add references" ON public.job_application_references;
DROP POLICY IF EXISTS "Anyone can insert work history" ON public.job_application_work_history;
DROP POLICY IF EXISTS "Anyone can add work history" ON public.job_application_work_history;

CREATE POLICY "Attach references to freshly submitted application"
  ON public.job_application_references
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_applications ja
      WHERE ja.id = application_id
        AND ja.submitted_at > now() - interval '1 hour'
    )
  );

CREATE POLICY "Attach work history to freshly submitted application"
  ON public.job_application_work_history
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_applications ja
      WHERE ja.id = application_id
        AND ja.submitted_at > now() - interval '1 hour'
    )
  );

-- ============ 3. vendor invoices: location scoping ============
DROP POLICY IF EXISTS "Users can view invoices at their locations" ON public.vendor_invoices;
DROP POLICY IF EXISTS "Users can insert invoices" ON public.vendor_invoices;
DROP POLICY IF EXISTS "Users can update their invoices" ON public.vendor_invoices;
DROP POLICY IF EXISTS "Users can delete their invoices" ON public.vendor_invoices;

CREATE POLICY "Users can view invoices at their locations"
  ON public.vendor_invoices FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can insert invoices at their locations"
  ON public.vendor_invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update invoices at their locations"
  ON public.vendor_invoices FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can delete invoices at their locations"
  ON public.vendor_invoices FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

DROP POLICY IF EXISTS "Users can view invoice items" ON public.vendor_invoice_items;
DROP POLICY IF EXISTS "Users can insert invoice items" ON public.vendor_invoice_items;
DROP POLICY IF EXISTS "Users can update invoice items" ON public.vendor_invoice_items;
DROP POLICY IF EXISTS "Users can delete invoice items" ON public.vendor_invoice_items;

CREATE POLICY "Users can view invoice items at their locations"
  ON public.vendor_invoice_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendor_invoices vi
    WHERE vi.id = invoice_id AND public.has_location_access(auth.uid(), vi.location_id)
  ));

CREATE POLICY "Users can insert invoice items at their locations"
  ON public.vendor_invoice_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vendor_invoices vi
    WHERE vi.id = invoice_id AND public.has_location_access(auth.uid(), vi.location_id)
  ));

CREATE POLICY "Users can update invoice items at their locations"
  ON public.vendor_invoice_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendor_invoices vi
    WHERE vi.id = invoice_id AND public.has_location_access(auth.uid(), vi.location_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.vendor_invoices vi
    WHERE vi.id = invoice_id AND public.has_location_access(auth.uid(), vi.location_id)
  ));

CREATE POLICY "Users can delete invoice items at their locations"
  ON public.vendor_invoice_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.vendor_invoices vi
    WHERE vi.id = invoice_id AND public.has_location_access(auth.uid(), vi.location_id)
  ));

-- ============ 4. service-role-only policies wrongly granted to public ============
DROP POLICY IF EXISTS "Service role can manage all orders" ON public.pfg_orders;
CREATE POLICY "Service role can manage all orders"
  ON public.pfg_orders FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage sales aggregates" ON public.sales_aggregates;
CREATE POLICY "Service role can manage sales aggregates"
  ON public.sales_aggregates FOR ALL TO service_role
  USING (true) WITH CHECK (true);