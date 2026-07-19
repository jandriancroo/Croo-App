
-- ============================================================================
-- PUNCH CLOCK DEVICE PAIRING
-- ============================================================================
-- Tablets can be paired to a specific location so no personal auth session
-- lives on them. Device auth users have NO role and NO user_locations, so
-- they naturally inherit only the anon-equivalent kiosk RLS policies.

-- 1. Pairing codes (short-lived, single-use)
CREATE TABLE public.punch_clock_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  redeemed_at timestamptz,
  redeemed_device_id uuid
);

CREATE INDEX idx_pairing_codes_code ON public.punch_clock_pairing_codes(code) WHERE redeemed_at IS NULL;
CREATE INDEX idx_pairing_codes_org ON public.punch_clock_pairing_codes(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.punch_clock_pairing_codes TO authenticated;
GRANT ALL ON public.punch_clock_pairing_codes TO service_role;
ALTER TABLE public.punch_clock_pairing_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org admins can view pairing codes"
  ON public.punch_clock_pairing_codes FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()) OR is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Org admins can create pairing codes"
  ON public.punch_clock_pairing_codes FOR INSERT TO authenticated
  WITH CHECK (
    (is_super_admin(auth.uid()) OR is_org_admin(auth.uid(), organization_id))
    AND created_by = auth.uid()
  );

CREATE POLICY "Org admins can delete pairing codes"
  ON public.punch_clock_pairing_codes FOR DELETE TO authenticated
  USING (is_super_admin(auth.uid()) OR is_org_admin(auth.uid(), organization_id));

-- 2. Paired devices (long-lived)
CREATE TABLE public.punch_clock_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_name text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  paired_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_punch_devices_org ON public.punch_clock_devices(organization_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_punch_devices_location ON public.punch_clock_devices(location_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_punch_devices_auth_user ON public.punch_clock_devices(auth_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.punch_clock_devices TO authenticated;
GRANT ALL ON public.punch_clock_devices TO service_role;
ALTER TABLE public.punch_clock_devices ENABLE ROW LEVEL SECURITY;

-- Org admins can see/manage devices in their org
CREATE POLICY "Org admins can view devices"
  ON public.punch_clock_devices FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()) OR is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Org admins can update devices"
  ON public.punch_clock_devices FOR UPDATE TO authenticated
  USING (is_super_admin(auth.uid()) OR is_org_admin(auth.uid(), organization_id))
  WITH CHECK (is_super_admin(auth.uid()) OR is_org_admin(auth.uid(), organization_id));

-- A device session can read its OWN row (to know its location + verify not revoked)
CREATE POLICY "Devices can read own record"
  ON public.punch_clock_devices FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- A device session can update its own last_active_at (heartbeat)
CREATE POLICY "Devices can heartbeat"
  ON public.punch_clock_devices FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() AND revoked_at IS NULL)
  WITH CHECK (auth_user_id = auth.uid());

-- 3. Helper: is the given user a punch device? (security definer so anon-lookup policies can call it if ever needed)
CREATE OR REPLACE FUNCTION public.is_punch_device(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.punch_clock_devices
    WHERE auth_user_id = _user_id AND revoked_at IS NULL
  );
$$;

-- 4. Random code generator (6 chars, unambiguous alphabet)
CREATE OR REPLACE FUNCTION public.generate_pairing_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no I, O, 0, 1
  result text := '';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;
