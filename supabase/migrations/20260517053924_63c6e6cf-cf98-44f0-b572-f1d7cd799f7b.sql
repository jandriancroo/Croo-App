-- Fix gen_salt/crypt not found: pgcrypto is in `extensions` schema, not public.
-- Recreate the two PIN-setting RPCs with schema-qualified calls.

CREATE OR REPLACE FUNCTION public.set_pending_punch_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_valid jsonb;
  v_hash text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_valid := public.validate_6_digit_pin(p_pin);
  IF NOT (v_valid->>'valid')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', v_valid->>'error');
  END IF;

  v_hash := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));

  UPDATE public.profiles
  SET pin_pending = v_hash,
      pin_pending_set_at = now(),
      pin_pending_set_by = v_user
  WHERE id = v_user;

  INSERT INTO public.pin_pending_audit (target_user_id, actor_user_id, action)
  VALUES (v_user, v_user, 'self_set');

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_pending_punch_pin(
  p_target_user_id uuid,
  p_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_valid jsonb;
  v_hash text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT public.has_role(v_actor, 'super_admin'::app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  v_valid := public.validate_6_digit_pin(p_pin);
  IF NOT (v_valid->>'valid')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', v_valid->>'error');
  END IF;

  v_hash := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));

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