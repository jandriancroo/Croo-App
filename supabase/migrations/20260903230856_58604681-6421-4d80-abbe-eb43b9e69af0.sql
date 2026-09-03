DROP POLICY IF EXISTS "Users can update assigned tasks or managers can update all" ON public.temporary_tasks;

CREATE POLICY "Users can update assigned tasks or managers can update all"
ON public.temporary_tasks
FOR UPDATE
TO authenticated
USING (
  -- Manager tier and above (includes shift_manager+, admin, org_admin, brand_admin, super_admin)
  (public.has_location_access(auth.uid(), location_id) AND public.has_role_or_higher(auth.uid(), 'manager'))
  -- Assignee (fixed: previously compared ta.task_id to ta.id and never matched)
  OR EXISTS (
    SELECT 1 FROM public.temporary_task_assignments ta
    WHERE ta.task_id = temporary_tasks.id
      AND (
        ta.user_id = auth.uid()
        OR ta.role = (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1)
      )
  )
  -- Identity: the employee named on the linked corrective action
  OR EXISTS (
    SELECT 1 FROM public.employee_writeups w
    WHERE w.id = temporary_tasks.write_up_id
      AND w.employee_id = auth.uid()
  )
)
WITH CHECK (
  (public.has_location_access(auth.uid(), location_id) AND public.has_role_or_higher(auth.uid(), 'manager'))
  OR EXISTS (
    SELECT 1 FROM public.temporary_task_assignments ta
    WHERE ta.task_id = temporary_tasks.id
      AND (
        ta.user_id = auth.uid()
        OR ta.role = (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1)
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.employee_writeups w
    WHERE w.id = temporary_tasks.write_up_id
      AND w.employee_id = auth.uid()
  )
);