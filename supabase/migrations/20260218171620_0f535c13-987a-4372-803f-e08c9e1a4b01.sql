-- Fix: The ALL policy applies to anon users too and may conflict with INSERT.
-- Scope the ALL policy to authenticated users only, and ensure anon INSERT works.

-- Drop the ALL policy that applies to all roles including anon
DROP POLICY IF EXISTS "Org admins can view and manage applications" ON public.job_applications;

-- Recreate it scoped to authenticated users only
CREATE POLICY "Org admins can view and manage applications"
ON public.job_applications
FOR ALL
TO authenticated
USING (can_manage_org_applications(auth.uid(), organization_id) OR has_location_access(auth.uid(), location_id))
WITH CHECK (can_manage_org_applications(auth.uid(), organization_id) OR has_location_access(auth.uid(), location_id));

-- Ensure the public INSERT policy explicitly includes anon
DROP POLICY IF EXISTS "Anyone can submit applications" ON public.job_applications;
CREATE POLICY "Anyone can submit applications"
ON public.job_applications
FOR INSERT
TO anon, authenticated
WITH CHECK (true);