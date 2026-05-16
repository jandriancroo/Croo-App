DROP POLICY IF EXISTS "Users can delete own pending requests" ON public.availability_requests;
CREATE POLICY "Users can delete own pending requests"
ON public.availability_requests
FOR DELETE
USING (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Admins can delete requests at their locations" ON public.availability_requests;
CREATE POLICY "Managers can delete requests at their locations"
ON public.availability_requests
FOR DELETE
USING (
  has_location_access(auth.uid(), location_id)
  AND has_role_or_higher(auth.uid(), 'shift_manager')
);