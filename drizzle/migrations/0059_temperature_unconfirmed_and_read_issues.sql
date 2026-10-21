ALTER TABLE public.checklist_responses ADD COLUMN IF NOT EXISTS temperature_unconfirmed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.checklist_responses.temperature_unconfirmed IS 'AI reading saved without two agreeing reads; cleared when crew confirms or types a value.';

CREATE TABLE public.temperature_read_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (reason IN ('read_failed','reads_disagree','one_read_failed','function_error')),
  reads jsonb,
  saved_temperature numeric,
  image_url text,
  item_id uuid,
  submission_id uuid,
  location_id uuid,
  user_id uuid NOT NULL DEFAULT auth.uid()
);
GRANT SELECT, INSERT ON public.temperature_read_issues TO authenticated;
GRANT ALL ON public.temperature_read_issues TO service_role;
ALTER TABLE public.temperature_read_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users log their own temperature read issues" ON public.temperature_read_issues
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Super admins read temperature read issues" ON public.temperature_read_issues
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX temperature_read_issues_created_at_idx ON public.temperature_read_issues (created_at);