-- Drop existing policies first
DROP POLICY IF EXISTS "Users can view rejection templates for their org" ON public.rejection_email_templates;
DROP POLICY IF EXISTS "Users can create rejection templates for their org" ON public.rejection_email_templates;
DROP POLICY IF EXISTS "Users can update rejection templates for their org" ON public.rejection_email_templates;
DROP POLICY IF EXISTS "Users can delete rejection templates for their org" ON public.rejection_email_templates;

-- Now drop and recreate the function with correct logic
DROP FUNCTION IF EXISTS public.can_manage_rejection_templates(uuid, uuid);

CREATE OR REPLACE FUNCTION public.can_manage_rejection_templates(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 
    -- Super admin can manage all
    is_super_admin(_user_id)
    -- Org admin can manage
    OR is_org_admin(_user_id, _organization_id)
    -- User with admin or manager role who has access to any location in this organization
    OR EXISTS (
      SELECT 1 
      FROM public.user_roles ur
      JOIN public.user_locations ul ON ul.user_id = ur.user_id
      JOIN public.locations l ON l.id = ul.location_id
      WHERE ur.user_id = _user_id 
        AND ur.role IN ('admin', 'org_admin', 'super_admin', 'manager', 'general_manager')
        AND l.organization_id = _organization_id
    )
$$;

-- Recreate the RLS policies
CREATE POLICY "Users can view rejection templates for their org"
ON public.rejection_email_templates
FOR SELECT
USING (can_manage_rejection_templates(auth.uid(), organization_id));

CREATE POLICY "Users can create rejection templates for their org"
ON public.rejection_email_templates
FOR INSERT
WITH CHECK (can_manage_rejection_templates(auth.uid(), organization_id));

CREATE POLICY "Users can update rejection templates for their org"
ON public.rejection_email_templates
FOR UPDATE
USING (can_manage_rejection_templates(auth.uid(), organization_id));

CREATE POLICY "Users can delete rejection templates for their org"
ON public.rejection_email_templates
FOR DELETE
USING (can_manage_rejection_templates(auth.uid(), organization_id));