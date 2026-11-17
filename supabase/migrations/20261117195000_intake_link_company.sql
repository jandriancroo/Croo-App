-- Optional company name per questionnaire link, used only to prefill the
-- editable Company box. Service role only: RLS stays on with no client
-- policies; client privileges stay revoked. No rows.

ALTER TABLE public.intake_links ADD COLUMN IF NOT EXISTS company text;

REVOKE ALL ON public.intake_links FROM anon, authenticated;
GRANT ALL ON public.intake_links TO service_role;
ALTER TABLE public.intake_links ENABLE ROW LEVEL SECURITY;
