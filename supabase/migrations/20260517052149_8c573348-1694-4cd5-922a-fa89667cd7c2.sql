-- ============================================================
-- PIN Migration Phase 1 + 2 foundation
-- Adds staging column for new 6-digit PINs (hashed) without
-- touching the live 4-digit employee_pin column. Flip night
-- (Phase 4) will promote pin_pending -> employee_pin.
-- ============================================================

-- pgcrypto for bcrypt-style hashing (crypt + gen_salt('bf'))
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Staging columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pin_pending TEXT NULL,
  ADD COLUMN IF NOT EXISTS pin_pending_set_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pin_pending_set_by UUID NULL;

COMMENT ON COLUMN public.profiles.pin_pending IS
  'Bcrypt hash of the user''s new 6-digit punch PIN. Staging slot — promoted to employee_pin on flip night.';
COMMENT ON COLUMN public.profiles.pin_pending_set_at IS
  'When the pending 6-digit PIN was set (by user or super-admin on behalf).';
COMMENT ON COLUMN public.profiles.pin_pending_set_by IS
  'NULL if user set their own PIN; super-admin user_id if set on behalf.';

-- Audit log of "set on behalf" actions
CREATE TABLE IF NOT EXISTS public.pin_pending_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('self_set','admin_set_on_behalf','nudged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pin_pending_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view pin audit"
  ON public.pin_pending_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'super_admin'));

-- ============================================================
-- Validation helper: 6 digits, not obviously weak
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_6_digit_pin(p_pin TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  weak_pins TEXT[] := ARRAY[
    '000000','111111','222222','333333','444444','555555',
    '666666','777777','888888','999999',
    '123456','654321','012345','543210',
    '121212','123123','112233'
  ];
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{6}$' THEN
    RETURN 'PIN must be exactly 6 digits.';
  END IF;
  IF p_pin = ANY(weak_pins) THEN
    RETURN 'That PIN is too easy to guess. Pick something less obvious.';
  END IF;
  RETURN NULL; -- valid
END;
$$;

-- ============================================================
-- RPC: user sets their own pending 6-digit PIN
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_pending_punch_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_error TEXT;
  v_hash TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated.');
  END IF;

  v_error := public.validate_6_digit_pin(p_pin);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_error);
  END IF;

  v_hash := crypt(p_pin, gen_salt('bf', 10));

  UPDATE public.profiles
  SET pin_pending = v_hash,
      pin_pending_set_at = now(),
      pin_pending_set_by = NULL
  WHERE id = v_user_id;

  INSERT INTO public.pin_pending_audit (target_user_id, actor_user_id, action)
  VALUES (v_user_id, v_user_id, 'self_set');

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_pending_punch_pin(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.set_pending_punch_pin(TEXT) TO authenticated;

-- ============================================================
-- RPC: super-admin sets a pending PIN on behalf of a user
-- Returns the plaintext PIN to the caller ONCE so super-admin
-- can text it to the user. PIN is then immediately hashed at rest.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_set_pending_punch_pin(p_target_user_id UUID, p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_error TEXT;
  v_hash TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated.');
  END IF;

  IF NOT public.has_role_or_higher(v_actor, 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Super-admin only.');
  END IF;

  v_error := public.validate_6_digit_pin(p_pin);
  IF v_error IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_error);
  END IF;

  v_hash := crypt(p_pin, gen_salt('bf', 10));

  UPDATE public.profiles
  SET pin_pending = v_hash,
      pin_pending_set_at = now(),
      pin_pending_set_by = v_actor
  WHERE id = p_target_user_id;

  INSERT INTO public.pin_pending_audit (target_user_id, actor_user_id, action)
  VALUES (p_target_user_id, v_actor, 'admin_set_on_behalf');

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_pending_punch_pin(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_pending_punch_pin(UUID, TEXT) TO authenticated;

-- ============================================================
-- RPC: super-admin logs a "nudge" (rate-limited at app layer)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_pin_nudge(p_target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_role_or_higher(v_actor, 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Super-admin only.');
  END IF;

  INSERT INTO public.pin_pending_audit (target_user_id, actor_user_id, action)
  VALUES (p_target_user_id, v_actor, 'nudged');

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.log_pin_nudge(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.log_pin_nudge(UUID) TO authenticated;
