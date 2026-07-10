-- Helper to upsert a vault secret by name (used by seed-push-vault edge function)
CREATE OR REPLACE FUNCTION public.upsert_vault_secret(_name text, _secret text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = _name LIMIT 1;
  IF existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(existing_id, _secret, _name);
    RETURN existing_id;
  ELSE
    RETURN vault.create_secret(_secret, _name);
  END IF;
END;
$$;

-- Only the service_role should invoke this; block anon/authenticated.
REVOKE ALL ON FUNCTION public.upsert_vault_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_vault_secret(text, text) TO service_role;