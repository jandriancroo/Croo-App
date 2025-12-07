-- Add UPDATE policy for chat_members so users can update their own pin status
CREATE POLICY "Users can update their own chat membership"
ON public.chat_members
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);