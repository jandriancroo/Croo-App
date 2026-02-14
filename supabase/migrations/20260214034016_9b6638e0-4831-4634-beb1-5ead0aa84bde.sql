-- Fix infinite recursion in scheduled_shifts RLS policy
-- The SELECT policy was self-referencing scheduled_shifts in its own USING clause
DROP POLICY IF EXISTS "Users can view shifts at their locations" ON public.scheduled_shifts;

CREATE POLICY "Users can view shifts at their locations"
ON public.scheduled_shifts
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM schedules s
    WHERE s.id = scheduled_shifts.schedule_id
      AND has_location_access(auth.uid(), s.location_id)
  )
);