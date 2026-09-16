CREATE TABLE public.inventory_deploy_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'unknown',
  started_at timestamptz NOT NULL DEFAULT now(),
  phase_1_result jsonb,
  phase_2_result jsonb,
  recipe_integrity_result jsonb,
  error text,
  completed_at timestamptz
);

CREATE INDEX idx_inventory_deploy_runs_location_started
  ON public.inventory_deploy_runs (location_id, started_at DESC);

GRANT SELECT ON public.inventory_deploy_runs TO authenticated;
GRANT ALL ON public.inventory_deploy_runs TO service_role;

ALTER TABLE public.inventory_deploy_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can view deploy runs for their locations"
ON public.inventory_deploy_runs
FOR SELECT
TO authenticated
USING (
  public.has_role_or_higher(auth.uid(), 'manager')
  AND (
    location_id IN (SELECT public.get_user_location_ids(auth.uid()))
    OR public.has_role_or_higher(auth.uid(), 'super_admin')
  )
);