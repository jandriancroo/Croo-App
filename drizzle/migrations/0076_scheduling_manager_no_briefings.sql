CREATE POLICY "Scheduling managers cannot read daily briefings"
ON public.croo_ai_briefings AS RESTRICTIVE FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) IS DISTINCT FROM 'scheduling_manager'::public.app_role);