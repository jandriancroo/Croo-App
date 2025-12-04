-- Update has_role function to include role hierarchy
-- super_admin automatically has all admin capabilities
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND (
        role = _role
        OR (role = 'super_admin'::app_role)  -- super_admin has all roles
        OR (role = 'org_admin'::app_role AND _role IN ('admin'::app_role, 'general_manager'::app_role, 'shift_manager'::app_role, 'manager'::app_role))
        OR (role = 'admin'::app_role AND _role IN ('general_manager'::app_role, 'shift_manager'::app_role, 'manager'::app_role))
      )
  )
$$;