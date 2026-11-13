-- Org / Location Active-Inactive switch (archive). Additive only.
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid,
  ADD COLUMN IF NOT EXISTS deactivated_by_org boolean NOT NULL DEFAULT false;
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid;

COMMENT ON COLUMN public.locations.deactivated_by_org IS 'True when this location was switched off only because its organization was switched off; it comes back on with the organization.';

-- Live check: location on AND its org on (missing values count as on).
CREATE OR REPLACE FUNCTION public.location_is_live(_location_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT COALESCE(l.is_active, true) AND COALESCE(o.is_active, true)
      FROM public.locations l LEFT JOIN public.organizations o ON o.id = l.organization_id
     WHERE l.id = _location_id
  ), true);
$$;
REVOKE EXECUTE ON FUNCTION public.location_is_live(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.location_is_live(uuid) TO authenticated, service_role;

-- Guard: only super admin (or server/service code) may change is_active.
CREATE OR REPLACE FUNCTION public._guard_active_switch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     AND COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can switch this on or off' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_location_active_switch ON public.locations;
CREATE TRIGGER trg_guard_location_active_switch
  BEFORE UPDATE OF is_active ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public._guard_active_switch();
DROP TRIGGER IF EXISTS trg_guard_org_active_switch ON public.organizations;
CREATE TRIGGER trg_guard_org_active_switch
  BEFORE UPDATE OF is_active ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public._guard_active_switch();

-- Super-admin switch for one location.
CREATE OR REPLACE FUNCTION public.set_location_active(_location_id uuid, _active boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _uid uuid := auth.uid(); _org_active boolean; _found boolean;
BEGIN
  IF _uid IS NULL OR NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'Only a super admin can switch locations on or off' USING ERRCODE = '42501';
  END IF;
  SELECT true, COALESCE(o.is_active, true) INTO _found, _org_active
    FROM public.locations l LEFT JOIN public.organizations o ON o.id = l.organization_id
   WHERE l.id = _location_id;
  IF NOT COALESCE(_found, false) THEN
    RAISE EXCEPTION 'Location not found' USING ERRCODE = 'P0002';
  END IF;
  IF _active THEN
    IF NOT _org_active THEN
      RAISE EXCEPTION 'Turn the organization back on first' USING ERRCODE = '22023';
    END IF;
    UPDATE public.locations
       SET is_active = true, deactivated_at = NULL, deactivated_by = NULL, deactivated_by_org = false
     WHERE id = _location_id;
  ELSE
    UPDATE public.locations
       SET is_active = false,
           deactivated_at = COALESCE(CASE WHEN is_active THEN now() END, deactivated_at, now()),
           deactivated_by = CASE WHEN is_active OR deactivated_by IS NULL THEN _uid ELSE deactivated_by END,
           deactivated_by_org = false
     WHERE id = _location_id;
  END IF;
  RETURN jsonb_build_object('location_id', _location_id, 'is_active', _active);
END $$;
REVOKE EXECUTE ON FUNCTION public.set_location_active(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_location_active(uuid, boolean) TO authenticated, service_role;

-- Super-admin switch for a whole organization (cascades to its active locations).
CREATE OR REPLACE FUNCTION public.set_organization_active(_org_id uuid, _active boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _uid uuid := auth.uid(); _n int := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_super_admin(_uid) THEN
    RAISE EXCEPTION 'Only a super admin can switch organizations on or off' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;
  IF _active THEN
    UPDATE public.organizations SET is_active = true, deactivated_at = NULL, deactivated_by = NULL WHERE id = _org_id;
    UPDATE public.locations
       SET is_active = true, deactivated_at = NULL, deactivated_by = NULL, deactivated_by_org = false
     WHERE organization_id = _org_id AND deactivated_by_org;
    GET DIAGNOSTICS _n = ROW_COUNT;
  ELSE
    UPDATE public.organizations
       SET is_active = false, deactivated_at = COALESCE(deactivated_at, now()), deactivated_by = COALESCE(deactivated_by, _uid)
     WHERE id = _org_id;
    UPDATE public.locations
       SET is_active = false, deactivated_at = now(), deactivated_by = _uid, deactivated_by_org = true
     WHERE organization_id = _org_id AND is_active;
    GET DIAGNOSTICS _n = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('organization_id', _org_id, 'is_active', _active, 'locations_changed', _n);
END $$;
REVOKE EXECUTE ON FUNCTION public.set_organization_active(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_organization_active(uuid, boolean) TO authenticated, service_role;

-- Choke points: no new phone alerts or emails for a switched-off location.
CREATE OR REPLACE FUNCTION public._skip_queue_for_inactive_location()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.location_id IS NOT NULL AND NOT public.location_is_live(NEW.location_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._skip_queue_for_inactive_location() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_skip_alert_inactive_location ON public.alert_queue;
CREATE TRIGGER trg_skip_alert_inactive_location
  BEFORE INSERT ON public.alert_queue
  FOR EACH ROW EXECUTE FUNCTION public._skip_queue_for_inactive_location();
DROP TRIGGER IF EXISTS trg_skip_email_inactive_location ON public.email_queue;
CREATE TRIGGER trg_skip_email_inactive_location
  BEFORE INSERT ON public.email_queue
  FOR EACH ROW EXECUTE FUNCTION public._skip_queue_for_inactive_location();