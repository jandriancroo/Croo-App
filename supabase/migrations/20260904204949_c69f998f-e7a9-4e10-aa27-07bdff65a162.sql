CREATE OR REPLACE FUNCTION public.is_task_assignee(_task_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.temporary_task_assignments ta
    WHERE ta.task_id = _task_id
      AND (
        ta.user_id = _user_id
        OR ta.role = (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = _user_id LIMIT 1)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_task_writeup_employee(_task_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.temporary_tasks t
    JOIN public.employee_writeups w ON w.id = t.write_up_id
    WHERE t.id = _task_id AND w.employee_id = _user_id
  )
$$;

DROP POLICY IF EXISTS "Users can update assigned tasks or managers can update all" ON public.temporary_tasks;

CREATE POLICY "Users can update assigned tasks or managers can update all"
ON public.temporary_tasks
FOR UPDATE
TO authenticated
USING (
  (public.has_location_access(auth.uid(), location_id) AND public.has_role_or_higher(auth.uid(), 'manager'))
  OR public.is_task_assignee(id, auth.uid())
  OR public.is_task_writeup_employee(id, auth.uid())
)
WITH CHECK (
  (public.has_location_access(auth.uid(), location_id) AND public.has_role_or_higher(auth.uid(), 'manager'))
  OR public.is_task_assignee(id, auth.uid())
  OR public.is_task_writeup_employee(id, auth.uid())
);