-- Remove the overly permissive public SELECT policies on hiring_conversations
DROP POLICY IF EXISTS "Public can view conversation by token" ON public.hiring_conversations;
DROP POLICY IF EXISTS "Staff can view hiring conversations" ON public.hiring_conversations;

-- Applicants access conversations via edge functions (service role) using access_token
-- Staff access via the already-existing "Staff can view conversations for their organization" policy (authenticated only)