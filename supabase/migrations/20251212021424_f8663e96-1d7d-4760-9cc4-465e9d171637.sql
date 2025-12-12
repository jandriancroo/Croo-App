-- Add tracking fields for admin edits on availability_requests
ALTER TABLE public.availability_requests 
ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES public.profiles(id),
ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone;

-- Update RLS policies to allow admins to update and delete any request
DROP POLICY IF EXISTS "Users can update their own requests" ON public.availability_requests;
DROP POLICY IF EXISTS "Admins can update requests at their locations" ON public.availability_requests;
DROP POLICY IF EXISTS "Admins can delete requests at their locations" ON public.availability_requests;

-- Users can update their own pending requests
CREATE POLICY "Users can update their own pending requests"
ON public.availability_requests
FOR UPDATE
USING (auth.uid() = user_id AND status = 'pending')
WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Admins can update any request at their locations
CREATE POLICY "Admins can update requests at their locations"
ON public.availability_requests
FOR UPDATE
USING (
  has_location_access(auth.uid(), location_id) 
  AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
);

-- Admins can delete requests at their locations
CREATE POLICY "Admins can delete requests at their locations"
ON public.availability_requests
FOR DELETE
USING (
  has_location_access(auth.uid(), location_id) 
  AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
);