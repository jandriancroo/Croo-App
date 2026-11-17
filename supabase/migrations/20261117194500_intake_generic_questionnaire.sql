-- One generic questionnaire behind one link: anyone can submit, any number of
-- times. Drops the one-submission-per-organization lock (UNIQUE(org)); the org
-- column and its link reference stay. Adds the submitter's typed company name.
-- RLS stays on with no client policies; client privileges stay revoked. No rows.

ALTER TABLE public.intake_submissions DROP CONSTRAINT IF EXISTS intake_submissions_org_key;
ALTER TABLE public.intake_submissions ADD COLUMN IF NOT EXISTS company text;

REVOKE ALL ON public.intake_submissions FROM anon, authenticated;
GRANT ALL ON public.intake_submissions TO service_role;
ALTER TABLE public.intake_submissions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.intake_submissions IS 'Pre-call questionnaire answers. Multiple submissions per link allowed. Service role only; no client policies.';
