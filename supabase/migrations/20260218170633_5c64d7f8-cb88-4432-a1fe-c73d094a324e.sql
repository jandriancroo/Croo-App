-- Drop the problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Public can view active organizations for applications" ON public.organizations;
DROP POLICY IF EXISTS "Public can view locations for applications" ON public.locations;

-- Create a security definer function to check org active status without triggering RLS
CREATE OR REPLACE FUNCTION public.is_org_active(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = _org_id AND is_active = true
  )
$$;

-- Re-create organization policy scoped to anon only (no subquery on locations)
CREATE POLICY "Public can view active organizations for applications"
ON public.organizations
FOR SELECT
TO anon
USING (is_active = true);

-- Re-create locations policy using security definer function to avoid recursion
CREATE POLICY "Public can view locations for applications"
ON public.locations
FOR SELECT
TO anon
USING (is_org_active(organization_id));