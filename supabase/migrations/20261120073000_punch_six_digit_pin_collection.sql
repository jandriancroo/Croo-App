-- Punch-time 6-digit PIN collection (Jordan, Nov 19 2026 11:08 PM PT).
-- 1. punch_clock_device_lookup_pin: on a match for someone with no 6-digit PIN yet (pin_pending NULL),
--    also returns needs_six_digit = true and a one-time upgrade_token (10 min, bound to this iPad,
--    its store and that employee; at most 3 per employee per hour; stored as sha256 of the token).
-- 2. punch_clock_set_six_digit_pin(_token, _pin): paired iPad only, same iPad + store as the token,
--    respects the #39 lockout, 5 tries per token. Blocks the easy-guess list (validate_6_digit_pin)
--    and any PIN another active employee at the same store already has (plaintext copy if present,
--    else bcrypt compare). Both rejections give the same generic message. Saves a bcrypt hash only
--    (pin_pending_plaintext stays NULL), audit action 'punch_clock_set'. The PIN is never logged.
-- 3. Fix set_pending_punch_pin / admin_set_pending_punch_pin: validate_6_digit_pin returns text
--    (NULL = valid), they cast it to jsonb, so a weak PIN errored instead of showing the message.
--    Their behavior is otherwise unchanged.
-- The legacy punch_clock_lookup_pin shim and 4-digit matching are unchanged.
-- Rollback: restore punch_clock_device_lookup_pin from 0104; DROP FUNCTION punch_clock_set_six_digit_pin(text,text);
--   DROP TABLE punch_pin_upgrade_tokens; restore the two set_* functions; audit CHECK without 'punch_clock_set'.

CREATE TABLE IF NOT EXISTS public.punch_pin_upgrade_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  location_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  tries integer NOT NULL DEFAULT 0,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS punch_pin_upgrade_tokens_user_idx ON public.punch_pin_upgrade_tokens (user_id, created_at DESC);
ALTER TABLE public.punch_pin_upgrade_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.punch_pin_upgrade_tokens FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.punch_pin_upgrade_tokens IS 'One-time punch clock tokens that let a just-matched employee set their 6-digit PIN. Server only.';

ALTER TABLE public.pin_pending_audit DROP CONSTRAINT IF EXISTS pin_pending_audit_action_check;
ALTER TABLE public.pin_pending_audit ADD CONSTRAINT pin_pending_audit_action_check
  CHECK (action = ANY (ARRAY['self_set'::text, 'admin_set_on_behalf'::text, 'nudged'::text, 'punch_clock_set'::text]));

CREATE OR REPLACE FUNCTION public.punch_clock_device_lookup_pin(_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb := public._punch_pin_lookup(_pin, true);
  v_user uuid;
  v_dev uuid;
  v_loc uuid;
  v_tok text;
BEGIN
  IF coalesce(r->>'status', '') <> 'ok' THEN
    RETURN r;
  END IF;
  v_user := (r->>'id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_user AND p.pin_pending IS NULL) THEN
    RETURN r || jsonb_build_object('needs_six_digit', false);
  END IF;

  SELECT d.id, d.location_id INTO v_dev, v_loc
  FROM public.punch_clock_devices d
  WHERE d.auth_user_id = auth.uid() AND d.revoked_at IS NULL
  ORDER BY d.paired_at DESC NULLS LAST
  LIMIT 1;

  DELETE FROM public.punch_pin_upgrade_tokens WHERE expires_at < now() - interval '1 day';
  -- Only the newest token works; older unused ones expire (rows stay for the hourly cap).
  UPDATE public.punch_pin_upgrade_tokens
     SET expires_at = least(expires_at, clock_timestamp())
   WHERE user_id = v_user AND used_at IS NULL;

  -- Prompt still shows (punch stays blocked); the save just can't start until the hour passes.
  IF (SELECT count(*) FROM public.punch_pin_upgrade_tokens t
       WHERE t.user_id = v_user AND t.created_at > now() - interval '1 hour') >= 3 THEN
    RETURN r || jsonb_build_object('needs_six_digit', true, 'upgrade_token', NULL);
  END IF;

  v_tok := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.punch_pin_upgrade_tokens (token_hash, user_id, device_id, location_id, expires_at)
  VALUES (encode(extensions.digest(v_tok, 'sha256'), 'hex'), v_user, v_dev, v_loc, clock_timestamp() + interval '10 minutes');

  RETURN r || jsonb_build_object('needs_six_digit', true, 'upgrade_token', v_tok);
END;
$$;
REVOKE ALL ON FUNCTION public.punch_clock_device_lookup_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punch_clock_device_lookup_pin(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.punch_clock_set_six_digit_pin(_token text, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_generic constant text := 'Pick a different PIN. Avoid easy patterns like 123456.';
  c_expired constant text := 'That took too long. Enter your 4-digit PIN again.';
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_dev uuid;
  v_loc uuid;
  v_until timestamptz;
  v_hash text;
  v_tok_hash text;
  t_user uuid;
  t_tries integer;
  v_dup boolean := false;
  rec record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_paired', 'error', 'This punch clock needs re-pairing. Ask a manager.');
  END IF;
  SELECT d.id, d.location_id INTO v_dev, v_loc
  FROM public.punch_clock_devices d
  WHERE d.auth_user_id = v_uid AND d.revoked_at IS NULL
  ORDER BY d.paired_at DESC NULLS LAST
  LIMIT 1;
  IF v_dev IS NULL OR v_loc IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_paired', 'error', 'This punch clock needs re-pairing. Ask a manager.');
  END IF;

  -- Same lockout as the PIN check (#39).
  SELECT max(l.locked_until) INTO v_until
  FROM public.punch_pin_lockouts l
  WHERE ((l.scope = 'device' AND l.scope_id = v_dev) OR (l.scope = 'location' AND l.scope_id = v_loc))
    AND l.locked_until > v_now;
  IF v_until IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'locked',
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_until - v_now))))::int);
  END IF;

  IF _token IS NULL OR _token !~ '^[0-9a-f]{48}$' THEN
    RETURN jsonb_build_object('success', false, 'code', 'expired', 'error', c_expired);
  END IF;
  v_tok_hash := encode(extensions.digest(_token, 'sha256'), 'hex');

  SELECT t.user_id, t.tries INTO t_user, t_tries
  FROM public.punch_pin_upgrade_tokens t
  WHERE t.token_hash = v_tok_hash
    AND t.device_id = v_dev
    AND t.location_id = v_loc
    AND t.used_at IS NULL
    AND t.expires_at > v_now
  FOR UPDATE;
  IF t_user IS NULL OR t_tries >= 5 THEN
    RETURN jsonb_build_object('success', false, 'code', 'expired', 'error', c_expired);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_locations ul ON ul.user_id = p.id AND ul.location_id = v_loc
    WHERE p.id = t_user AND p.is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'expired', 'error', c_expired);
  END IF;

  -- Set somewhere else in the meantime: nothing to do, let the punch go through.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t_user AND p.pin_pending IS NOT NULL) THEN
    UPDATE public.punch_pin_upgrade_tokens SET used_at = v_now WHERE token_hash = v_tok_hash;
    RETURN jsonb_build_object('success', true, 'already_set', true);
  END IF;

  IF _pin IS NULL OR _pin !~ '^[0-9]{6}$' THEN
    UPDATE public.punch_pin_upgrade_tokens SET tries = tries + 1 WHERE token_hash = v_tok_hash;
    RETURN jsonb_build_object('success', false, 'code', 'invalid', 'error', 'PIN must be exactly 6 digits.');
  END IF;

  IF public.validate_6_digit_pin(_pin) IS NOT NULL THEN
    UPDATE public.punch_pin_upgrade_tokens SET tries = tries + 1 WHERE token_hash = v_tok_hash;
    RETURN jsonb_build_object('success', false, 'code', 'rejected', 'error', c_generic);
  END IF;

  -- Same-store duplicate (salted hashes, so compare one by one). Never say who.
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_locations ul ON ul.user_id = p.id AND ul.location_id = v_loc
    WHERE p.id <> t_user AND p.is_active = true AND p.pin_pending_plaintext = _pin
  ) THEN
    v_dup := true;
  ELSE
    FOR rec IN
      SELECT DISTINCT p.pin_pending
      FROM public.profiles p
      JOIN public.user_locations ul ON ul.user_id = p.id AND ul.location_id = v_loc
      WHERE p.id <> t_user AND p.is_active = true
        AND p.pin_pending IS NOT NULL AND p.pin_pending_plaintext IS NULL
    LOOP
      IF extensions.crypt(_pin, rec.pin_pending) = rec.pin_pending THEN
        v_dup := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;
  IF v_dup THEN
    UPDATE public.punch_pin_upgrade_tokens SET tries = tries + 1 WHERE token_hash = v_tok_hash;
    RETURN jsonb_build_object('success', false, 'code', 'rejected', 'error', c_generic);
  END IF;

  v_hash := extensions.crypt(_pin, extensions.gen_salt('bf', 10));
  UPDATE public.profiles
     SET pin_pending = v_hash,
         pin_pending_plaintext = NULL,
         pin_pending_set_at = v_now,
         pin_pending_set_by = t_user
   WHERE id = t_user AND pin_pending IS NULL;

  INSERT INTO public.pin_pending_audit (target_user_id, actor_user_id, action)
  VALUES (t_user, t_user, 'punch_clock_set');

  UPDATE public.punch_pin_upgrade_tokens SET used_at = v_now WHERE token_hash = v_tok_hash;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.punch_clock_set_six_digit_pin(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punch_clock_set_six_digit_pin(text, text) TO authenticated, service_role;

-- Caller bug fix: validate_6_digit_pin returns text, NULL = valid.
CREATE OR REPLACE FUNCTION public.set_pending_punch_pin(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_err text;
  v_hash text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_err := public.validate_6_digit_pin(p_pin);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  v_hash := extensions.crypt(p_pin, extensions.gen_salt('bf', 10));

  UPDATE public.profiles
  SET pin_pending = v_hash,
      pin_pending_plaintext = p_pin,
      pin_pending_set_at = now(),
      pin_pending_set_by = v_user
  WHERE id = v_user;

  INSERT INTO public.pin_pending_audit (target_user_id, actor_user_id, action)
  VALUES (v_user, v_user, 'self_set');

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_pending_punch_pin(p_target_user_id uuid, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_err text;
  v_hash text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT public.has_role_or_higher(v_actor, 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  v_err := public.validate_6_digit_pin(p_pin);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_err);
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
