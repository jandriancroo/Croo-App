CREATE TABLE public.brand_integration_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  integration_key text NOT NULL CHECK (integration_key IN ('qubeyond', 'clover', 'aloha', 'pfg', 'produce_alliance', 'ovation')),
  category text NOT NULL CHECK (category IN ('pos', 'vendor', 'guest_feedback')),
  is_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, integration_key)
);

GRANT SELECT ON public.brand_integration_policies TO authenticated;
GRANT ALL ON public.brand_integration_policies TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.brand_integration_policies TO authenticated;

ALTER TABLE public.brand_integration_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view brand integration policies"
ON public.brand_integration_policies
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Super admins can create brand integration policies"
ON public.brand_integration_policies
FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update brand integration policies"
ON public.brand_integration_policies
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete brand integration policies"
ON public.brand_integration_policies
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE UNIQUE INDEX brand_integration_policies_one_primary_pos
ON public.brand_integration_policies (brand_id)
WHERE category = 'pos' AND is_enabled = true;

CREATE INDEX brand_integration_policies_brand_enabled
ON public.brand_integration_policies (brand_id, is_enabled);

CREATE OR REPLACE FUNCTION public.set_brand_integration_policy_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_brand_integration_policy_updated_at
BEFORE UPDATE ON public.brand_integration_policies
FOR EACH ROW
EXECUTE FUNCTION public.set_brand_integration_policy_updated_at();

INSERT INTO public.brand_integration_policies (brand_id, integration_key, category, is_enabled)
SELECT b.id, catalog.integration_key, catalog.category,
  CASE
    WHEN catalog.integration_key = 'ovation' THEN EXISTS (
      SELECT 1 FROM public.ovation_integrations oi
      WHERE oi.brand_id = b.id AND oi.is_active = true
    )
    ELSE EXISTS (
      SELECT 1
      FROM public.locations l
      LEFT JOIN public.organizations o ON o.id = l.organization_id
      JOIN public.location_integrations li ON li.location_id = l.id
      WHERE COALESCE(l.brand_id, o.brand_id) = b.id
        AND li.integration_type = catalog.integration_key
        AND li.is_active = true
    )
  END
FROM public.brands b
CROSS JOIN (VALUES
  ('qubeyond', 'pos'),
  ('clover', 'pos'),
  ('aloha', 'pos'),
  ('pfg', 'vendor'),
  ('produce_alliance', 'vendor'),
  ('ovation', 'guest_feedback')
) AS catalog(integration_key, category)
ON CONFLICT (brand_id, integration_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_brand_integration_enabled(
  _brand_id uuid,
  _integration_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.brand_integration_policies bip
    WHERE bip.brand_id = _brand_id
      AND bip.integration_key = _integration_key
      AND bip.is_enabled = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_brand_integration_enabled(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_location_integration_brand_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_brand_id uuid;
  was_active boolean := false;
BEGIN
  IF NEW.integration_type NOT IN ('qubeyond', 'clover', 'aloha', 'pfg', 'produce_alliance') OR NEW.is_active = false THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    was_active := OLD.is_active = true
      AND OLD.integration_type = NEW.integration_type
      AND OLD.location_id = NEW.location_id;
  END IF;

  IF was_active THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(l.brand_id, o.brand_id)
  INTO resolved_brand_id
  FROM public.locations l
  LEFT JOIN public.organizations o ON o.id = l.organization_id
  WHERE l.id = NEW.location_id;

  IF resolved_brand_id IS NULL OR NOT public.is_brand_integration_enabled(resolved_brand_id, NEW.integration_type) THEN
    RAISE EXCEPTION 'This integration is not enabled for the location brand';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_location_integration_brand_policy
BEFORE INSERT OR UPDATE OF location_id, integration_type, is_active
ON public.location_integrations
FOR EACH ROW
EXECUTE FUNCTION public.guard_location_integration_brand_policy();