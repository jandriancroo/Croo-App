-- Broaden chat_members INSERT policy so chats can always add members
DROP POLICY IF EXISTS "Chat creators can add members" ON chat_members;

CREATE POLICY "Authenticated users can add chat members"
ON chat_members FOR INSERT
TO authenticated
WITH CHECK (true);