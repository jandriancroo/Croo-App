-- Drop the existing restrictive UPDATE policy
DROP POLICY IF EXISTS "Admins and managers can update temporary tasks" ON public.temporary_tasks;

-- Create new UPDATE policy that allows:
-- 1. Admins and managers to update any task at their location
-- 2. Any assigned user to complete their own assigned tasks
CREATE POLICY "Users can update assigned tasks or managers can update all"
ON public.temporary_tasks
FOR UPDATE
USING (
  has_location_access(auth.uid(), location_id) AND (
    -- Admins and managers can update any task
    has_role(auth.uid(), 'admin'::app_role) OR 
    has_role(auth.uid(), 'manager'::app_role) OR
    -- Assigned users can update (complete) their own tasks
    EXISTS (
      SELECT 1 FROM public.temporary_task_assignments ta
      WHERE ta.task_id = id AND (
        ta.user_id = auth.uid() OR
        ta.role = (SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1)
      )
    )
  )
);