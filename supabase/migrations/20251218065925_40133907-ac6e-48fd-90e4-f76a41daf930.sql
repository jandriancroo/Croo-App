-- Helper RPC to check if a location has an active integration without exposing credentials
-- (Prevents leaking api tokens/credentials to non-admin roles)
CREATE OR REPLACE FUNCTION public.has_active_location_integration(
  _location_id uuid,
  _integration_type text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.location_integrations li
    WHERE li.location_id = _location_id
      AND li.integration_type = _integration_type
      AND li.is_active = true
  );
$$;

-- Allow authenticated users to call it
GRANT EXECUTE ON FUNCTION public.has_active_location_integration(uuid, text) TO authenticated;