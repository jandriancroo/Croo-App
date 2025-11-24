-- Temporarily allow any authenticated user to create chats
DROP POLICY IF EXISTS "Users can create chats" ON chats;

CREATE POLICY "Authenticated users can create chats"
ON chats FOR INSERT
TO authenticated
WITH CHECK (true);