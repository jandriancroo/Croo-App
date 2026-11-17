-- Private pre-call questionnaire (/q/:slug) for one prospect.
-- Two new tables, service role only: RLS on, no client policies, all client
-- privileges revoked. UNIQUE(org) on intake_submissions is the server-side
-- one-submission-per-organization lock. No rows are seeded here (the link row
-- is seeded separately so the slug is not in the repo).

CREATE TABLE public.intake_links (
  slug text PRIMARY KEY,
  org text NOT NULL UNIQUE,
  org_label text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org text NOT NULL UNIQUE REFERENCES public.intake_links(org),
  name text NOT NULL,
  is_test boolean NOT NULL DEFAULT false,
  answers jsonb NOT NULL,
  email_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.intake_links FROM anon, authenticated;
REVOKE ALL ON public.intake_submissions FROM anon, authenticated;
GRANT ALL ON public.intake_links TO service_role;
GRANT ALL ON public.intake_submissions TO service_role;

ALTER TABLE public.intake_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intake_submissions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.intake_links IS 'Private pre-call questionnaire links (/q/:slug). Service role only; no client policies.';
COMMENT ON TABLE public.intake_submissions IS 'Pre-call questionnaire answers. UNIQUE(org) = one submission per organization. Service role only; no client policies.';
