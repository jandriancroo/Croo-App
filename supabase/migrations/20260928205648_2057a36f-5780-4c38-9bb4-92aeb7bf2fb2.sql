-- Toast employee ↔ CrooHQ profile linking (needed for read-only Toast labor pairing)
CREATE TABLE public.toast_employee_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  toast_user_id text NOT NULL,
  toast_restaurant_user_id text,
  toast_name text,
  croo_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  match_method text NOT NULL DEFAULT 'auto' CHECK (match_method IN ('auto', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, toast_user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.toast_employee_mappings TO authenticated;
GRANT ALL ON public.toast_employee_mappings TO service_role;

ALTER TABLE public.toast_employee_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers manage toast employee mappings"
  ON public.toast_employee_mappings
  FOR ALL
  TO authenticated
  USING (
    public.has_role_or_higher(auth.uid(), 'shift_manager')
    AND public.has_location_access(auth.uid(), location_id)
  )
  WITH CHECK (
    public.has_role_or_higher(auth.uid(), 'shift_manager')
    AND public.has_location_access(auth.uid(), location_id)
  );

CREATE TRIGGER set_toast_employee_mappings_updated_at
  BEFORE UPDATE ON public.toast_employee_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Coop's Toast connection now feeds store labor (read-only punches from Toast).
UPDATE public.location_integrations
  SET credentials = jsonb_set(credentials, '{pull_labor}', 'true'::jsonb)
  WHERE integration_type = 'toast'
    AND location_id = '0d1477e5-791d-42f4-9245-ad8b2e75c41c';