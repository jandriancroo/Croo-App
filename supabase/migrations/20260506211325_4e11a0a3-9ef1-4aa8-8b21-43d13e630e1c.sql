
CREATE TABLE public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_templates_org ON public.report_templates(organization_id);

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view report templates"
ON public.report_templates FOR SELECT
TO authenticated
USING (
  public.has_role_or_higher(auth.uid(), 'org_admin')
  OR EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = report_templates.organization_id
      AND om.user_id = auth.uid()
  )
);

CREATE POLICY "Org admins can insert report templates"
ON public.report_templates FOR INSERT
TO authenticated
WITH CHECK (public.has_role_or_higher(auth.uid(), 'org_admin'));

CREATE POLICY "Org admins can update report templates"
ON public.report_templates FOR UPDATE
TO authenticated
USING (public.has_role_or_higher(auth.uid(), 'org_admin'))
WITH CHECK (public.has_role_or_higher(auth.uid(), 'org_admin'));

CREATE POLICY "Org admins can delete report templates"
ON public.report_templates FOR DELETE
TO authenticated
USING (public.has_role_or_higher(auth.uid(), 'org_admin'));

CREATE TRIGGER report_templates_updated_at
BEFORE UPDATE ON public.report_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
