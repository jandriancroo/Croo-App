
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
      WHEN 'super_admin' THEN 0
      WHEN 'brand_admin' THEN 1
      WHEN 'org_admin' THEN 2
      WHEN 'admin' THEN 3
      WHEN 'manager' THEN 4
      WHEN 'general_manager' THEN 4
      WHEN 'shift_manager' THEN 5
      WHEN 'team_member' THEN 6
    END
  LIMIT 1
$$;
