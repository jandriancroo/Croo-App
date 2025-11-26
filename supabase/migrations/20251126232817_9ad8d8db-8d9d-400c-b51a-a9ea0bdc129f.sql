-- Allow all authenticated users to view basic profile information for chat functionality
-- This is safe because profile information is already visible in chats
CREATE POLICY "All users can view basic profile info"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);