-- Fix SELECT RLS so chat creators can see their own chats immediately after insert
DROP POLICY IF EXISTS "Users can view their chats" ON chats;

CREATE POLICY "Users can view their chats"
ON chats FOR SELECT
TO authenticated
USING (
  public.is_chat_member(auth.uid(), id)
  OR created_by = auth.uid()
);