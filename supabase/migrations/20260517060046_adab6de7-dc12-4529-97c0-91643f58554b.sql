-- Revert manager visibility — super_admin only
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

  IF NOT public.has_role_or_higher(v_actor, 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  v_valid := public.validate_6_digit_pin(p_pin);
  IF NOT (v_valid->>'valid')::boolean THEN
    RETURN jsonb_build_object('success', false, 'error', v_valid->>'error');
  END IF;

  v_hash := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));

  UPDATE public.profiles
  SET pin_pending = v_hash,
      pin_pending_plaintext = p_pin,
      pin_pending_set_at = now(),
      pin_pending_set_by = v_actor
  WHERE id = p_target_user_id;

  INSERT INTO public.pin_pending_audit (target_user_id, actor_user_id, action)
  VALUES (p_target_user_id, v_actor, 'admin_set_on_behalf');

  RETURN jsonb_build_object('success', true);
END;
$$;

DROP FUNCTION IF EXISTS public.get_pin_migration_health();
CREATE OR REPLACE FUNCTION public.get_pin_migration_health()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  pin_pending TEXT,
  pin_pending_plaintext TEXT,
  pin_pending_set_at TIMESTAMPTZ,
  location_ids UUID[],
  location_names TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role_or_higher(auth.uid(), 'super_admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.pin_pending,
    p.pin_pending_plaintext,
    p.pin_pending_set_at,
    COALESCE(ARRAY_AGG(l.id) FILTER (WHERE l.id IS NOT NULL), ARRAY[]::UUID[]) AS location_ids,
    COALESCE(ARRAY_AGG(l.name ORDER BY l.name) FILTER (WHERE l.name IS NOT NULL), ARRAY[]::TEXT[]) AS location_names
  FROM public.profiles p
  LEFT JOIN public.user_locations ul ON ul.user_id = p.id
  LEFT JOIN public.locations l ON l.id = ul.location_id
  GROUP BY p.id, p.full_name, p.pin_pending, p.pin_pending_plaintext, p.pin_pending_set_at
  ORDER BY p.full_name NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pin_migration_health() FROM public;
GRANT EXECUTE ON FUNCTION public.get_pin_migration_health() TO authenticated;