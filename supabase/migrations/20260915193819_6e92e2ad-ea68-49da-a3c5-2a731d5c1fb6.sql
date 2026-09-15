-- Confirmed alternate spellings for a registry vendor
CREATE TABLE public.vendor_registry_aliases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.vendor_registry(id) ON DELETE CASCADE,
  normalized_alias text NOT NULL,
  raw_alias text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_alias)
);

GRANT SELECT, INSERT ON public.vendor_registry_aliases TO authenticated;
GRANT ALL ON public.vendor_registry_aliases TO service_role;
ALTER TABLE public.vendor_registry_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read vendor aliases"
  ON public.vendor_registry_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can add vendor aliases"
  ON public.vendor_registry_aliases FOR INSERT TO authenticated
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'manager'));
CREATE POLICY "Service role manages vendor aliases"
  ON public.vendor_registry_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_vendor_registry_aliases_vendor ON public.vendor_registry_aliases(vendor_id);
CREATE INDEX idx_vendor_registry_aliases_trgm ON public.vendor_registry_aliases USING gin (normalized_alias gin_trgm_ops);

-- Vendor names read off invoices that need a human tap before linking
CREATE TABLE public.vendor_name_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  suggested_vendor_id uuid REFERENCES public.vendor_registry(id) ON DELETE SET NULL,
  similarity_score numeric,
  status text NOT NULL DEFAULT 'pending',
  invoice_id uuid,
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_id uuid,
  resolved_vendor_id uuid REFERENCES public.vendor_registry(id) ON DELETE SET NULL,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.vendor_name_candidates TO authenticated;
GRANT ALL ON public.vendor_name_candidates TO service_role;
ALTER TABLE public.vendor_name_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can read vendor name candidates"
  ON public.vendor_name_candidates FOR SELECT TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'manager'));
CREATE POLICY "Managers can resolve vendor name candidates"
  ON public.vendor_name_candidates FOR UPDATE TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'manager'))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'manager'));
CREATE POLICY "Managers can add vendor name candidates"
  ON public.vendor_name_candidates FOR INSERT TO authenticated
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'manager'));
CREATE POLICY "Service role manages vendor name candidates"
  ON public.vendor_name_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE UNIQUE INDEX idx_vendor_name_candidates_pending
  ON public.vendor_name_candidates(normalized_name)
  WHERE status = 'pending';
CREATE INDEX idx_vendor_name_candidates_status ON public.vendor_name_candidates(status, created_at DESC);

CREATE TRIGGER update_vendor_name_candidates_updated_at
  BEFORE UPDATE ON public.vendor_name_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigram index for fuzzy matching against registry names
CREATE INDEX IF NOT EXISTS idx_vendor_registry_key_trgm
  ON public.vendor_registry USING gin (key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendor_registry_display_trgm
  ON public.vendor_registry USING gin (display_name gin_trgm_ops);

-- Shared normalizer: lowercase, strip legal suffixes and punctuation
CREATE OR REPLACE FUNCTION public.normalize_vendor_name(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
           regexp_replace(lower(coalesce(_name, '')),
             '\y(inc|llc|l\.l\.c|corp|corporation|co|ltd|company|distributing|distributors)\y\.?', ' ', 'g'),
           '[^a-z0-9]', '', 'g')
$$;

-- Closest known vendor for a name: exact alias/key/display first, then trigram similarity
CREATE OR REPLACE FUNCTION public.match_vendor_name(_name text)
RETURNS TABLE(vendor_id uuid, vendor_key text, display_name text, score numeric, exact boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (SELECT public.normalize_vendor_name(_name) AS norm),
  candidates AS (
    SELECT vr.id, vr.key, vr.display_name,
           GREATEST(
             similarity(public.normalize_vendor_name(vr.key), (SELECT norm FROM n)),
             similarity(public.normalize_vendor_name(vr.display_name), (SELECT norm FROM n)),
             COALESCE((
               SELECT MAX(similarity(a.normalized_alias, (SELECT norm FROM n)))
               FROM public.vendor_registry_aliases a WHERE a.vendor_id = vr.id
             ), 0)
           )::numeric AS score,
           (
             public.normalize_vendor_name(vr.key) = (SELECT norm FROM n)
             OR public.normalize_vendor_name(vr.display_name) = (SELECT norm FROM n)
             OR EXISTS (
               SELECT 1 FROM public.vendor_registry_aliases a
               WHERE a.vendor_id = vr.id AND a.normalized_alias = (SELECT norm FROM n)
             )
           ) AS exact
    FROM public.vendor_registry vr
  )
  SELECT id, key, display_name, score, exact
  FROM candidates
  WHERE (SELECT norm FROM n) <> ''
  ORDER BY exact DESC, score DESC
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.match_vendor_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_vendor_name(text) TO authenticated, service_role;