CREATE OR REPLACE FUNCTION public.is_brand_integration_enabled(
  _brand_id uuid,
  _integration_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
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

REVOKE ALL ON FUNCTION public.guard_location_integration_brand_policy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_brand_integration_policy_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_brand_integration_enabled(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_brand_integration_enabled(uuid, text) TO authenticated, service_role;