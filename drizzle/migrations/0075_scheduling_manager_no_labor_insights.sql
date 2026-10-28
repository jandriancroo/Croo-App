CREATE POLICY "Scheduling managers cannot read labor insights"
ON public.labor_insights AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) IS DISTINCT FROM 'scheduling_manager'::public.app_role);