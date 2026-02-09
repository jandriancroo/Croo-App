
-- Drop the restrictive delete policy
DROP POLICY IF EXISTS "Users can leave chats" ON public.chat_members;

-- Create a new policy that allows:
-- 1. Users to remove themselves from any chat
-- 2. Chat creators to remove anyone from their chats
-- 3. Admins (org_admin, admin, super_admin) to remove anyone from location chats they have access to
CREATE POLICY "Users can leave or admins can remove members"
ON public.chat_members
FOR DELETE
USING (
  -- Users can always remove themselves
  auth.uid() = user_id
  OR
  -- Chat creator can remove anyone
  EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_id AND c.created_by = auth.uid()
  )
  OR
  -- Admins can remove members from location chats they have access to
  EXISTS (
    SELECT 1 FROM chats c
    JOIN user_locations ul ON ul.location_id = c.location_id
    JOIN user_roles ur ON ur.user_id = auth.uid()
    WHERE c.id = chat_id 
      AND ul.user_id = auth.uid()
      AND ur.role IN ('admin', 'org_admin', 'super_admin')
  )
);
