-- Punch clock PIN lookup: paired iPads only, server-side miss lockout, no plaintext PINs.
-- 1. punch_clock_device_lookup_pin(_pin): caller must be a live paired device (punch_clock_devices,
--    revoked_at NULL); the store comes from the device row, never from the client.
--    Matches active staff assigned to that store only (no "no store = any store" fallback;
--    0 such punches in the 30 days before this ship).
-- 2. Misses are counted per device and per store in punch_pin_lockouts:
--    device: 5 misses in 5 min -> 2 min lockout; store: 10 misses in 5 min -> 3 min lockout.
--    A match clears the device counter. While locked, PINs are not checked at all.
-- 3. punch_clock_attempts is written by the server (pin_entered NULL); a trigger nulls
--    pin_entered on every insert so cached old clients can't store plaintext either.
--    Existing rows are left alone (no delete without Jordan).
-- 4. Old punch_clock_lookup_pin(_pin,_location_id): anon/PUBLIC lose EXECUTE; for cached
--    iPad bundles it stays callable by authenticated but only answers for a paired device,
--    at the device's own store, through the same lockout. Drop it once every iPad reloads.
-- Rollback: restore punch_clock_lookup_pin from 20260730055212 + GRANT EXECUTE TO anon;
--   DROP FUNCTION punch_clock_device_lookup_pin(text), _punch_pin_lookup(text,boolean);
--   DROP TRIGGER trg_punch_attempt_strip_pin ON punch_clock_attempts; DROP TABLE punch_pin_lockouts.

CREATE TABLE IF NOT EXISTS public.punch_pin_lockouts (
  scope text NOT NULL CHECK (scope IN ('device','location')),
  scope_id uuid NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  miss_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_id)
);
ALTER TABLE public.punch_pin_lockouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.punch_pin_lockouts FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.punch_pin_lockouts IS 'Punch clock wrong-PIN counters per paired device and per store. Server only (definer functions).';

-- No plaintext PINs in the attempt log, from any client version.
ALTER TABLE public.punch_clock_attempts ALTER COLUMN pin_entered DROP NOT NULL;
CREATE OR REPLACE FUNCTION public._punch_attempt_strip_pin()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.pin_entered := NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_punch_attempt_strip_pin ON public.punch_clock_attempts;
CREATE TRIGGER trg_punch_attempt_strip_pin
  BEFORE INSERT OR UPDATE OF pin_entered ON public.punch_clock_attempts
  FOR EACH ROW EXECUTE FUNCTION public._punch_attempt_strip_pin();
REVOKE ALL ON FUNCTION public._punch_attempt_strip_pin() FROM PUBLIC, anon, authenticated;

-- Shared lookup. _log = true writes the attempt row (new client); false leaves logging to the
-- caller (cached old bundles still insert their own row, minus the PIN via the trigger).
CREATE OR REPLACE FUNCTION public._punch_pin_lookup(_pin text, _log boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_dev_max   constant integer  := 5;
  c_dev_win   constant interval := interval '5 minutes';
  c_dev_lock  constant interval := interval '2 minutes';
  c_loc_max   constant integer  := 10;
  c_loc_win   constant interval := interval '5 minutes';
  c_loc_lock  constant interval := interval '3 minutes';
  v_uid   uuid := auth.uid();
  v_now   timestamptz := clock_timestamp();
  v_dev_id uuid;
  v_loc   uuid;
  v_until timestamptz;
  v_mid   uuid;
  v_mname text;
  v_mphoto text;
  v_cnt   integer;
  v_tz    text;
  v_ids   uuid[] := '{}';
  v_names text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_paired');
  END IF;

  SELECT d.id, d.location_id INTO v_dev_id, v_loc
  FROM public.punch_clock_devices d
  WHERE d.auth_user_id = v_uid AND d.revoked_at IS NULL
  ORDER BY d.paired_at DESC NULLS LAST
  LIMIT 1;
  IF v_dev_id IS NULL OR v_loc IS NULL THEN
    RETURN jsonb_build_object('status', 'not_paired');
  END IF;

  -- Locked out? Do not even look at the PIN.
  SELECT max(l.locked_until) INTO v_until
  FROM public.punch_pin_lockouts l
  WHERE ((l.scope = 'device' AND l.scope_id = v_dev_id) OR (l.scope = 'location' AND l.scope_id = v_loc))
    AND l.locked_until > v_now;
  IF v_until IS NOT NULL THEN
    IF _log THEN
      INSERT INTO public.punch_clock_attempts (location_id, pin_entered, success, attempt_time)
      VALUES (v_loc, NULL, false, v_now);
    END IF;
    RETURN jsonb_build_object('status', 'locked',
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_until - v_now))))::int);
  END IF;

  IF _pin IS NOT NULL AND _pin ~ '^[0-9]{4,6}$' THEN
    SELECT p.id, p.full_name, p.profile_photo_url INTO v_mid, v_mname, v_mphoto
    FROM public.profiles p
    WHERE p.employee_pin = _pin
      AND p.is_active = true
      AND EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = p.id AND ul.location_id = v_loc)
    LIMIT 1;
  END IF;

  IF v_mid IS NOT NULL THEN
    DELETE FROM public.punch_pin_lockouts WHERE scope = 'device' AND scope_id = v_dev_id;
    IF _log THEN
      INSERT INTO public.punch_clock_attempts (location_id, pin_entered, success, matched_user_id, attempt_time)
      VALUES (v_loc, NULL, true, v_mid, v_now);
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'id', v_mid,
      'full_name', v_mname, 'profile_photo_url', v_mphoto);
  END IF;

  -- Miss: count it per device and per store (atomic upserts).
  INSERT INTO public.punch_pin_lockouts AS l (scope, scope_id, window_start, miss_count, updated_at)
  VALUES ('device', v_dev_id, v_now, 1, v_now)
  ON CONFLICT (scope, scope_id) DO UPDATE SET
    window_start = CASE WHEN l.window_start <= v_now - c_dev_win THEN v_now ELSE l.window_start END,
    miss_count   = CASE WHEN l.window_start <= v_now - c_dev_win THEN 1 ELSE l.miss_count + 1 END,
    updated_at   = v_now
  RETURNING miss_count INTO v_cnt;
  IF v_cnt >= c_dev_max THEN
    UPDATE public.punch_pin_lockouts
       SET locked_until = v_now + c_dev_lock, miss_count = 0, window_start = v_now
     WHERE scope = 'device' AND scope_id = v_dev_id;
    v_until := v_now + c_dev_lock;
  END IF;

  INSERT INTO public.punch_pin_lockouts AS l (scope, scope_id, window_start, miss_count, updated_at)
  VALUES ('location', v_loc, v_now, 1, v_now)
  ON CONFLICT (scope, scope_id) DO UPDATE SET
    window_start = CASE WHEN l.window_start <= v_now - c_loc_win THEN v_now ELSE l.window_start END,
    miss_count   = CASE WHEN l.window_start <= v_now - c_loc_win THEN 1 ELSE l.miss_count + 1 END,
    updated_at   = v_now
  RETURNING miss_count INTO v_cnt;
  IF v_cnt >= c_loc_max THEN
    UPDATE public.punch_pin_lockouts
       SET locked_until = v_now + c_loc_lock, miss_count = 0, window_start = v_now
     WHERE scope = 'location' AND scope_id = v_loc;
    v_until := greatest(coalesce(v_until, v_now), v_now + c_loc_lock);
  END IF;

  IF _log THEN
    -- Same "who might this be" guess the kiosk used to make, scoped to this store's schedule.
    SELECT coalesce(ls.timezone, 'America/Los_Angeles') INTO v_tz
    FROM public.location_settings ls WHERE ls.location_id = v_loc;
    v_tz := coalesce(v_tz, 'America/Los_Angeles');
    SELECT coalesce(array_agg(g.id), '{}'), coalesce(array_agg(g.name), '{}') INTO v_ids, v_names
    FROM (
      SELECT DISTINCT p.id, coalesce(p.full_name, 'Unknown') AS name
      FROM public.scheduled_shifts s
      JOIN public.schedules sc ON sc.id = s.schedule_id AND sc.location_id = v_loc
      JOIN public.profiles p ON p.id = s.user_id
      WHERE s.shift_date = (v_now AT TIME ZONE v_tz)::date
        AND s.start_time BETWEEN ((v_now AT TIME ZONE v_tz) - interval '2 hours')::time
                             AND ((v_now AT TIME ZONE v_tz) + interval '2 hours')::time
      LIMIT 20
    ) g;
    INSERT INTO public.punch_clock_attempts (location_id, pin_entered, success, guessed_user_ids, guessed_user_names, attempt_time)
    VALUES (v_loc, NULL, false, v_ids, v_names, v_now);
  END IF;

  IF v_until IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'locked',
      'retry_after_seconds', greatest(1, ceil(extract(epoch FROM (v_until - v_now))))::int);
  END IF;
  RETURN jsonb_build_object('status', 'miss');
END;
$$;
REVOKE ALL ON FUNCTION public._punch_pin_lookup(text, boolean) FROM PUBLIC, anon, authenticated;

-- New kiosk entry point (paired device session only).
CREATE OR REPLACE FUNCTION public.punch_clock_device_lookup_pin(_pin text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public._punch_pin_lookup(_pin, true);
$$;
REVOKE ALL ON FUNCTION public.punch_clock_device_lookup_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punch_clock_device_lookup_pin(text) TO authenticated, service_role;

-- Old entry point, kept only for iPads still running the previous bundle. _location_id is ignored.
CREATE OR REPLACE FUNCTION public.punch_clock_lookup_pin(_pin text, _location_id uuid)
RETURNS TABLE(id uuid, full_name text, profile_photo_url text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb := public._punch_pin_lookup(_pin, false);
BEGIN
  IF r->>'status' = 'ok' THEN
    id := (r->>'id')::uuid;
    full_name := r->>'full_name';
    profile_photo_url := r->>'profile_photo_url';
    RETURN NEXT;
  END IF;
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.punch_clock_lookup_pin(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.punch_clock_lookup_pin(text, uuid) TO authenticated, service_role;
