
-- Security definer function to check if user is brand admin or super admin
CREATE OR REPLACE FUNCTION public.is_brand_or_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin', 'brand_admin')
  )
$$;
