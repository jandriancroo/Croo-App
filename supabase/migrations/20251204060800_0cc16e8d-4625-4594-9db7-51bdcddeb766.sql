
-- Phase 1b: Create organizations structure

-- 1. Create organizations table
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. Create organization_members table
CREATE TABLE public.organization_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_role TEXT NOT NULL DEFAULT 'member' CHECK (org_role IN ('admin', 'member')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 3. Add organization_id to locations
ALTER TABLE public.locations ADD COLUMN organization_id UUID REFERENCES public.organizations(id);

-- 4. Helper function: is_super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'
  )
$$;

-- 5. Helper function: is_org_member
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _organization_id
  )
$$;

-- 6. Helper function: is_org_admin
CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = _user_id 
      AND organization_id = _organization_id 
      AND org_role = 'admin'
  )
$$;

-- 7. RLS for organizations
CREATE POLICY "Super admins can manage all organizations"
ON public.organizations FOR ALL
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Org members can view their organizations"
ON public.organizations FOR SELECT
USING (
  is_super_admin(auth.uid()) OR
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = organizations.id AND user_id = auth.uid()
  )
);

-- 8. RLS for organization_members
CREATE POLICY "Super admins can manage all org members"
ON public.organization_members FOR ALL
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Org admins can manage their org members"
ON public.organization_members FOR ALL
USING (is_org_admin(auth.uid(), organization_id))
WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Users can view org members in their orgs"
ON public.organization_members FOR SELECT
USING (
  is_super_admin(auth.uid()) OR
  is_org_member(auth.uid(), organization_id)
);

-- 9. Update locations RLS
DROP POLICY IF EXISTS "Admins can manage locations" ON public.locations;
DROP POLICY IF EXISTS "Users can view their assigned locations" ON public.locations;

CREATE POLICY "Super admins can manage all locations"
ON public.locations FOR ALL
USING (is_super_admin(auth.uid()))
WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Org admins can manage locations in their org"
ON public.locations FOR ALL
USING (organization_id IS NOT NULL AND is_org_admin(auth.uid(), organization_id))
WITH CHECK (organization_id IS NOT NULL AND is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Location admins can manage their locations"
ON public.locations FOR ALL
USING (
  has_role(auth.uid(), 'admin') AND
  EXISTS (SELECT 1 FROM public.user_locations WHERE location_id = locations.id AND user_id = auth.uid())
)
WITH CHECK (
  has_role(auth.uid(), 'admin') AND
  EXISTS (SELECT 1 FROM public.user_locations WHERE location_id = locations.id AND user_id = auth.uid())
);

CREATE POLICY "Users can view their assigned locations"
ON public.locations FOR SELECT
USING (
  is_super_admin(auth.uid()) OR
  EXISTS (SELECT 1 FROM public.user_locations WHERE location_id = locations.id AND user_id = auth.uid())
);

-- 10. Trigger for updated_at
CREATE TRIGGER update_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
