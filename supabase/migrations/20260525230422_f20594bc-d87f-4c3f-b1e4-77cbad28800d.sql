-- Add org-scoped plan catalogs
ALTER TABLE public.plan_catalogs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- A catalog can be scoped to global (both null), brand-wide, OR org-specific, but never both
ALTER TABLE public.plan_catalogs
  DROP CONSTRAINT IF EXISTS plan_catalogs_scope_chk;
ALTER TABLE public.plan_catalogs
  ADD CONSTRAINT plan_catalogs_scope_chk
  CHECK (NOT (brand_id IS NOT NULL AND organization_id IS NOT NULL));

-- At most one active catalog per organization
CREATE UNIQUE INDEX IF NOT EXISTS plan_catalogs_org_unique
  ON public.plan_catalogs (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS plan_catalogs_org_idx
  ON public.plan_catalogs (organization_id);