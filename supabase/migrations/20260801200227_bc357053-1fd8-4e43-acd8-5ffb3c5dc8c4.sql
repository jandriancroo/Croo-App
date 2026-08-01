CREATE POLICY "Punch device can insert alarm completions at its location"
ON public.alarm_task_completions
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    WHERE tt.id = alarm_task_completions.task_id
      AND tt.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);