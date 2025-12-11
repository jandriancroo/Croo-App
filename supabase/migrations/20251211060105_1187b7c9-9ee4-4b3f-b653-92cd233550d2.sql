-- Create hiring conversations table
CREATE TABLE public.hiring_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create hiring messages table
CREATE TABLE public.hiring_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.hiring_conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('staff', 'applicant')),
  sender_id UUID REFERENCES public.profiles(id), -- NULL for applicant messages
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.hiring_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hiring_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for hiring_conversations

-- Staff with location access can view conversations
CREATE POLICY "Staff can view hiring conversations"
ON public.hiring_conversations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM job_applications ja
    WHERE ja.id = hiring_conversations.application_id
    AND (
      is_super_admin(auth.uid()) 
      OR is_org_admin(auth.uid(), ja.organization_id)
      OR has_location_access(auth.uid(), ja.location_id)
    )
  )
);

-- Staff can create conversations
CREATE POLICY "Staff can create hiring conversations"
ON public.hiring_conversations
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM job_applications ja
    WHERE ja.id = application_id
    AND (
      is_super_admin(auth.uid()) 
      OR is_org_admin(auth.uid(), ja.organization_id)
      OR has_location_access(auth.uid(), ja.location_id)
    )
  )
);

-- Public can view conversations by token (for applicants)
CREATE POLICY "Public can view conversation by token"
ON public.hiring_conversations
FOR SELECT
USING (true);

-- RLS policies for hiring_messages

-- Staff can view messages in conversations they have access to
CREATE POLICY "Staff can view hiring messages"
ON public.hiring_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM hiring_conversations hc
    JOIN job_applications ja ON ja.id = hc.application_id
    WHERE hc.id = hiring_messages.conversation_id
    AND (
      is_super_admin(auth.uid()) 
      OR is_org_admin(auth.uid(), ja.organization_id)
      OR has_location_access(auth.uid(), ja.location_id)
    )
  )
);

-- Staff can send messages
CREATE POLICY "Staff can send hiring messages"
ON public.hiring_messages
FOR INSERT
WITH CHECK (
  sender_type = 'staff' 
  AND sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM hiring_conversations hc
    JOIN job_applications ja ON ja.id = hc.application_id
    WHERE hc.id = conversation_id
    AND (
      is_super_admin(auth.uid()) 
      OR is_org_admin(auth.uid(), ja.organization_id)
      OR has_location_access(auth.uid(), ja.location_id)
    )
  )
);

-- Public can view messages by conversation (for applicants via edge function)
CREATE POLICY "Public can view messages"
ON public.hiring_messages
FOR SELECT
USING (true);

-- Public can insert applicant messages (validated by edge function)
CREATE POLICY "Public can send applicant messages"
ON public.hiring_messages
FOR INSERT
WITH CHECK (sender_type = 'applicant' AND sender_id IS NULL);

-- Enable realtime for hiring messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.hiring_messages;

-- Create indexes
CREATE INDEX idx_hiring_conversations_application ON public.hiring_conversations(application_id);
CREATE INDEX idx_hiring_conversations_token ON public.hiring_conversations(access_token);
CREATE INDEX idx_hiring_messages_conversation ON public.hiring_messages(conversation_id);
CREATE INDEX idx_hiring_messages_created ON public.hiring_messages(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_hiring_conversations_updated_at
  BEFORE UPDATE ON public.hiring_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();