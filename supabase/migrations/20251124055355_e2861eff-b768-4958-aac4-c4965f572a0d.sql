-- Drop ALL existing chat-related policies
DROP POLICY IF EXISTS "Users can view chats they are members of" ON chats;
DROP POLICY IF EXISTS "Users can create chats" ON chats;
DROP POLICY IF EXISTS "Admins and managers can create group chats" ON chats;
DROP POLICY IF EXISTS "Chat creators can update their chats" ON chats;

DROP POLICY IF EXISTS "Users can view chat members for their chats" ON chat_members;
DROP POLICY IF EXISTS "Chat creators can add members" ON chat_members;
DROP POLICY IF EXISTS "Users can insert chat members" ON chat_members;
DROP POLICY IF EXISTS "Users can leave chats" ON chat_members;

-- Create security definer function to check chat membership
CREATE OR REPLACE FUNCTION public.is_chat_member(_user_id uuid, _chat_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_members
    WHERE user_id = _user_id
      AND chat_id = _chat_id
  )
$$;

-- Create new policies for chats table using the function
CREATE POLICY "Users can view their chats"
ON chats FOR SELECT
TO authenticated
USING (public.is_chat_member(auth.uid(), id));

CREATE POLICY "Users can create direct chats"
ON chats FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND (
    is_group = false
    OR (is_group = true AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')))
  )
);

CREATE POLICY "Chat creators can update"
ON chats FOR UPDATE
TO authenticated
USING (auth.uid() = created_by);

-- Create new policies for chat_members table
CREATE POLICY "Users can view members of their chats"
ON chat_members FOR SELECT
TO authenticated
USING (public.is_chat_member(auth.uid(), chat_id));

CREATE POLICY "Chat creators can add members"
ON chat_members FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM chats
    WHERE chats.id = chat_members.chat_id
    AND chats.created_by = auth.uid()
  )
);

CREATE POLICY "Users can leave chats"
ON chat_members FOR DELETE
TO authenticated
USING (auth.uid() = user_id);