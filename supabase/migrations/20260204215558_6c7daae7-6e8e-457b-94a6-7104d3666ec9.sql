-- Drop the overly permissive public RLS policy that lets everyone see all organizations
-- This was causing org admins to see ALL organizations, not just their own

DROP POLICY IF EXISTS "Public can view active organizations" ON public.organizations;

-- The existing policies provide proper scoped access:
-- 1. "Super admins can manage all organizations" - super_admins see everything
-- 2. "Org members can view their organizations" - users see orgs they're members of
-- 3. "Brand admins can view orgs in their brand" - brand admins see orgs in their brands
-- 4. "Public can view organizations for QR tasks" - limited public access for QR task flows