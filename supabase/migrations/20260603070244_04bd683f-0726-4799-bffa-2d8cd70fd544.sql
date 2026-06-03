
-- =====================================================================
-- SANDBOX COUNT SYSTEM — FOUNDATION
-- =====================================================================

-- 1) Locations: add super-admin gating + brand seam ---------------------
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS requires_super_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand_id uuid;

COMMENT ON COLUMN public.locations.requires_super_admin IS
  'When true, the location is hidden from every role except those that pass public.can_see_admin_locations(auth.uid()). Used today to hide the Sandbox location from non-super-admins.';

COMMENT ON COLUMN public.locations.brand_id IS
  'Future seam: a brand_admin role will be scoped to locations sharing this brand_id. Today this column is informational and used to attribute the Sandbox location to a brand.';

-- 2) Admin-visibility helper -------------------------------------------
-- Future: when brand_admin role is added, extend this function with one
-- more OR clause. Every RLS policy that calls this helper inherits the
-- change — do NOT update individual policies.
CREATE OR REPLACE FUNCTION public.can_see_admin_locations(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id);
  -- Future: OR public.has_role(_user_id, 'brand_admin')
$$;

COMMENT ON FUNCTION public.can_see_admin_locations(uuid) IS
  'Single chokepoint for "can this user see super-admin-only locations". Today: super_admin only. Future: extend with brand_admin (and any further admin-tier roles) here so every dependent RLS policy inherits the change.';

-- 3) Replace locations RLS policies with sandbox-gated versions --------
DROP POLICY IF EXISTS "Users can view their assigned locations" ON public.locations;
DROP POLICY IF EXISTS "Brand admins can view locations in their brand" ON public.locations;
DROP POLICY IF EXISTS "Org admins can manage locations in their org" ON public.locations;
DROP POLICY IF EXISTS "Location admins can manage their locations" ON public.locations;
DROP POLICY IF EXISTS "Super admins can manage all locations" ON public.locations;
DROP POLICY IF EXISTS "Public can view locations for QR tasks" ON public.locations;
DROP POLICY IF EXISTS "Public can view locations for applications" ON public.locations;

-- Super admins keep full access (and are the only ones who see sandbox locations)
CREATE POLICY "Super admins can manage all locations"
ON public.locations
FOR ALL
USING ((SELECT public.is_super_admin(auth.uid())))
WITH CHECK ((SELECT public.is_super_admin(auth.uid())));

-- Assigned-location view (gated)
CREATE POLICY "Users can view their assigned locations"
ON public.locations
FOR SELECT
USING (
  (requires_super_admin = false OR public.can_see_admin_locations(auth.uid()))
  AND (
    (SELECT public.is_super_admin(auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.user_locations
      WHERE user_locations.location_id = locations.id
        AND user_locations.user_id = (SELECT auth.uid())
    )
  )
);

-- Brand admin view (gated; existing has_brand_access helper)
CREATE POLICY "Brand admins can view locations in their brand"
ON public.locations
FOR SELECT
USING (
  (requires_super_admin = false OR public.can_see_admin_locations(auth.uid()))
  AND organization_id IS NOT NULL
  AND (SELECT public.has_brand_access(auth.uid(), locations.organization_id))
);

-- Org admin manage (gated)
CREATE POLICY "Org admins can manage locations in their org"
ON public.locations
FOR ALL
USING (
  (requires_super_admin = false OR public.can_see_admin_locations(auth.uid()))
  AND organization_id IS NOT NULL
  AND (SELECT public.is_org_admin(auth.uid(), locations.organization_id))
)
WITH CHECK (
  (requires_super_admin = false OR public.can_see_admin_locations(auth.uid()))
  AND organization_id IS NOT NULL
  AND (SELECT public.is_org_admin(auth.uid(), locations.organization_id))
);

-- Location admin manage (gated)
CREATE POLICY "Location admins can manage their locations"
ON public.locations
FOR ALL
USING (
  (requires_super_admin = false OR public.can_see_admin_locations(auth.uid()))
  AND (SELECT public.has_role(auth.uid(), 'admin'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.user_locations
    WHERE user_locations.location_id = locations.id
      AND user_locations.user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  (requires_super_admin = false OR public.can_see_admin_locations(auth.uid()))
  AND (SELECT public.has_role(auth.uid(), 'admin'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.user_locations
    WHERE user_locations.location_id = locations.id
      AND user_locations.user_id = (SELECT auth.uid())
  )
);

-- Public (anon) QR task lookup — sandbox locations never expose QR tasks
CREATE POLICY "Public can view locations for QR tasks"
ON public.locations
FOR SELECT
USING (
  requires_super_admin = false
  AND EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    WHERE tt.location_id = locations.id
      AND tt.is_qr_triggered = true
      AND tt.is_active = true
      AND tt.qr_code IS NOT NULL
  )
);

-- Public (anon) application lookup — sandbox locations never expose hiring
CREATE POLICY "Public can view locations for applications"
ON public.locations
FOR SELECT
USING (
  requires_super_admin = false
  AND public.is_org_active(organization_id)
);

-- 4) inventory_counts: source-tracking columns + sandbox-owner RLS -----
ALTER TABLE public.inventory_counts
  ADD COLUMN IF NOT EXISTS cloned_from_location_id uuid,
  ADD COLUMN IF NOT EXISTS cloned_from_count_id uuid,
  ADD COLUMN IF NOT EXISTS cloned_at timestamptz;

-- Sandbox counts: owner-only access (does not replace existing
-- non-sandbox policies; those continue to apply when is_sandbox = false).
DROP POLICY IF EXISTS "Sandbox counts visible to owner" ON public.inventory_counts;
CREATE POLICY "Sandbox counts visible to owner"
ON public.inventory_counts
FOR ALL
USING (
  is_sandbox = true
  AND sandbox_owner = (SELECT auth.uid())
  AND public.can_see_admin_locations(auth.uid())
)
WITH CHECK (
  is_sandbox = true
  AND sandbox_owner = (SELECT auth.uid())
  AND public.can_see_admin_locations(auth.uid())
);

-- 5) sandbox_active_fix — outstanding fix being tested in sandbox ------
CREATE TABLE IF NOT EXISTS public.sandbox_active_fix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_owner uuid NOT NULL,
  sandbox_count_id uuid NOT NULL,
  source_location_id uuid NOT NULL,
  source_count_id uuid NOT NULL,
  source_location_name text,
  source_count_label text,
  bug_description text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz,
  deployed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_active_fix_owner
  ON public.sandbox_active_fix(sandbox_owner);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sandbox_active_fix TO authenticated;
GRANT ALL ON public.sandbox_active_fix TO service_role;

ALTER TABLE public.sandbox_active_fix ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sandbox fix owner-only access"
ON public.sandbox_active_fix
FOR ALL
USING (
  sandbox_owner = (SELECT auth.uid())
  AND public.can_see_admin_locations(auth.uid())
)
WITH CHECK (
  sandbox_owner = (SELECT auth.uid())
  AND public.can_see_admin_locations(auth.uid())
);

CREATE TRIGGER update_sandbox_active_fix_updated_at
BEFORE UPDATE ON public.sandbox_active_fix
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
