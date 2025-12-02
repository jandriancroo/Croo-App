-- Add unique constraint for user_id + platform combination
ALTER TABLE public.push_notification_tokens 
ADD CONSTRAINT push_notification_tokens_user_id_platform_key UNIQUE (user_id, platform);

-- Allow users to update their own tokens
DROP POLICY IF EXISTS "Users can update their own tokens" ON public.push_notification_tokens;
CREATE POLICY "Users can update their own tokens" 
ON public.push_notification_tokens 
FOR UPDATE 
USING (auth.uid() = user_id);