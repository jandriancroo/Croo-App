-- Drop the old restrictive INSERT policy
DROP POLICY IF EXISTS "Authenticated users can insert alarm completions" ON public.alarm_task_completions;

-- Create new INSERT policy that allows any user with location access to insert completions
-- (They can record that any clocked-in employee completed the task)
CREATE POLICY "Users can insert alarm completions for their location"
ON public.alarm_task_completions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.temporary_tasks tt
    JOIN public.user_locations ul ON ul.location_id = tt.location_id
    WHERE tt.id = task_id
      AND ul.user_id = auth.uid()
  )
);