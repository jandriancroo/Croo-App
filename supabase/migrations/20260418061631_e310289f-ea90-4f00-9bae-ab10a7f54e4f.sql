-- Atomic compare-and-swap for PFG refresh tokens.
-- Returns TRUE if the swap was applied (current refresh_token == expected_old_refresh_token),
-- FALSE if another process already wrote a newer token (skip the write — they won the race).
CREATE OR REPLACE FUNCTION public.pfg_swap_credentials(
  p_integration_id UUID,
  p_expected_old_refresh_token TEXT,
  p_new_credentials JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_refresh TEXT;
BEGIN
  -- Lock the row for the duration of this transaction.
  -- Any concurrent caller hits this same SELECT FOR UPDATE and blocks until we commit.
  SELECT credentials->>'refresh_token'
    INTO v_current_refresh
  FROM public.location_integrations
  WHERE id = p_integration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Compare-and-swap: only write if the token in the DB still matches what we read before
  -- calling B2C. If a faster concurrent caller already rotated to a newer token, skip our write
  -- (our token is now dead anyway — Azure invalidated it the moment they minted the next one).
  IF v_current_refresh IS DISTINCT FROM p_expected_old_refresh_token THEN
    RETURN FALSE;
  END IF;

  UPDATE public.location_integrations
     SET credentials = p_new_credentials,
         updated_at  = now()
   WHERE id = p_integration_id;

  RETURN TRUE;
END;
$$;

-- Allow the service role (edge functions) to call it
GRANT EXECUTE ON FUNCTION public.pfg_swap_credentials(UUID, TEXT, JSONB) TO service_role;

-- Forensic logging table — captures who refreshed, what handler triggered it, outcome.
-- Cheap, append-only, no RLS overhead (only edge functions write to it).
CREATE TABLE IF NOT EXISTS public.pfg_refresh_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL,
  location_id  UUID,
  handler      TEXT NOT NULL,                 -- 'keep_alive_cron' | 'get_valid_access_token' | 'save_token'
  caller_action TEXT,                         -- whatever invoked it: 'sync', 'sync_orders', 'manual_paste', etc
  outcome      TEXT NOT NULL,                 -- 'swapped' | 'lost_race' | 'b2c_error' | 'b2c_timeout' | 'no_token'
  b2c_error_code TEXT,
  b2c_error_message TEXT,
  duration_ms  INTEGER,
  old_token_prefix TEXT,                      -- first 12 chars only — for correlation, not secrets
  new_token_prefix TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pfg_refresh_audit_loc_time
  ON public.pfg_refresh_audit (location_id, created_at DESC);

ALTER TABLE public.pfg_refresh_audit ENABLE ROW LEVEL SECURITY;

-- Brand admins / super admins can read for diagnostics
CREATE POLICY "Admins can read refresh audit"
  ON public.pfg_refresh_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'brand_admin', 'admin')
    )
  );