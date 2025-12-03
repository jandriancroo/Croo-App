-- Update existing 'manager' roles to 'shift_manager'
UPDATE public.user_roles SET role = 'shift_manager' WHERE role = 'manager';

-- Update the get_user_role function to include the new hierarchy
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'general_manager' THEN 2
      WHEN 'shift_manager' THEN 3
      WHEN 'manager' THEN 3
      WHEN 'team_member' THEN 4
    END
  LIMIT 1
$$;