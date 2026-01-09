-- Create table for role-based dashboard cube configurations
-- Org Admins can define which cubes each role sees
CREATE TABLE public.role_dashboard_cubes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('team_member', 'shift_manager', 'manager', 'general_manager')),
  cubes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  
  -- Each org can only have one config per role
  UNIQUE (organization_id, role)
);

-- Add comment
COMMENT ON TABLE public.role_dashboard_cubes IS 'Stores dashboard cube configurations per role per organization. Org Admins define what cubes each role sees.';

-- Enable RLS
ALTER TABLE public.role_dashboard_cubes ENABLE ROW LEVEL SECURITY;

-- Policy: Org admins can manage their org's cube configs
CREATE POLICY "Org admins can manage role cube configs"
ON public.role_dashboard_cubes
FOR ALL
TO authenticated
USING (
  public.is_org_admin(auth.uid(), organization_id)
  OR public.is_super_admin(auth.uid())
  OR public.has_brand_access(auth.uid(), organization_id)
);

-- Policy: All org members can read their org's configs
CREATE POLICY "Org members can read role cube configs"
ON public.role_dashboard_cubes
FOR SELECT
TO authenticated
USING (
  public.is_org_member(auth.uid(), organization_id)
);

-- Add updated_at trigger
CREATE TRIGGER update_role_dashboard_cubes_updated_at
  BEFORE UPDATE ON public.role_dashboard_cubes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();