
-- Drop existing policies
DROP POLICY IF EXISTS "Super admins can view changelog" ON public.changelog_entries;
DROP POLICY IF EXISTS "Super admins can manage changelog" ON public.changelog_entries;

-- Recreate with correct logic using has_role which handles hierarchy
CREATE POLICY "Super admins can view changelog" 
ON public.changelog_entries 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'super_admin'
  )
);

CREATE POLICY "Super admins can manage changelog" 
ON public.changelog_entries 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'super_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'super_admin'
  )
);
