-- v3: ROPC-specific lock function. ROPC generates a fresh grant chain unrelated
-- to the old refresh token, so the token-match CAS in pfg_swap_credentials would
-- always lose. This variant locks the row but skips the match check — two
-- concurrent ROPC writers serialize and the last (equally-valid) writer wins.
CREATE OR REPLACE FUNCTION public.pfg_swap_credentials_ropc(
  p_integration_id UUID,
  p_new_credentials JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM id FROM public.location_integrations
   WHERE id = p_integration_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.location_integrations
     SET credentials = p_new_credentials,
         updated_at  = now()
   WHERE id = p_integration_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pfg_swap_credentials_ropc(UUID, JSONB) TO service_role;