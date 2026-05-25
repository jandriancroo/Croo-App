DROP INDEX IF EXISTS public.plan_catalogs_global_default_unique;
CREATE UNIQUE INDEX plan_catalogs_global_default_unique
  ON public.plan_catalogs ((true))
  WHERE brand_id IS NULL AND organization_id IS NULL;