-- Drop existing policies on user_locations
DROP POLICY IF EXISTS "Admins can manage user location assignments" ON public.user_locations;
DROP POLICY IF EXISTS "Users can view their own location assignments" ON public.user_locations;

-- Create updated policies that include super_admin
CREATE POLICY "Admins and super_admins can manage user location assignments"
ON public.user_locations
FOR ALL
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view their own location assignments"
ON public.user_locations
FOR SELECT
USING (auth.uid() = user_id);

-- Also allow admins/super_admins to view all user_locations (SELECT)
CREATE POLICY "Admins can view all user location assignments"
ON public.user_locations
FOR SELECT
USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));