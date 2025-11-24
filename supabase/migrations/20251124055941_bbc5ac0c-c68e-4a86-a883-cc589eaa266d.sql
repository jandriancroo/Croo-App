-- Relax chats INSERT policy to fix 403 errors
DROP POLICY IF EXISTS "Users can create direct chats" ON chats;

CREATE POLICY "Users can create chats"
ON chats FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);