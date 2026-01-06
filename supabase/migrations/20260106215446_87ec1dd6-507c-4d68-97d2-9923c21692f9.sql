-- Create support ticket status enum
CREATE TYPE public.support_ticket_status AS ENUM ('open', 'in_progress', 'resolved');

-- Create support ticket category enum
CREATE TYPE public.support_ticket_category AS ENUM (
  'ui_glitch',
  'broken_feature', 
  'login_issues',
  'data_sync_issues',
  'notification_issues',
  'scheduling_issues',
  'other'
);

-- Create support_tickets table
CREATE TABLE public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_number SERIAL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category support_ticket_category NOT NULL,
  description TEXT NOT NULL,
  screenshot_url TEXT,
  occurrence_time TIMESTAMPTZ,
  status support_ticket_status NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id),
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create support_messages table for conversation thread
CREATE TABLE public.support_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for support_tickets
-- Users can view their own tickets
CREATE POLICY "Users can view their own tickets"
ON public.support_tickets FOR SELECT
USING (auth.uid() = user_id);

-- Super admins can view all tickets
CREATE POLICY "Super admins can view all tickets"
ON public.support_tickets FOR SELECT
USING (public.is_super_admin(auth.uid()));

-- Shift managers and above can create tickets
CREATE POLICY "Shift managers and above can create tickets"
ON public.support_tickets FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);

-- Super admins can update tickets (for resolution)
CREATE POLICY "Super admins can update tickets"
ON public.support_tickets FOR UPDATE
USING (public.is_super_admin(auth.uid()));

-- RLS policies for support_messages
-- Users can view messages for their tickets
CREATE POLICY "Users can view messages for their tickets"
ON public.support_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.support_tickets 
    WHERE id = ticket_id AND user_id = auth.uid()
  )
);

-- Super admins can view all messages
CREATE POLICY "Super admins can view all messages"
ON public.support_messages FOR SELECT
USING (public.is_super_admin(auth.uid()));

-- Ticket owners can send messages
CREATE POLICY "Ticket owners can send messages"
ON public.support_messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND EXISTS (
    SELECT 1 FROM public.support_tickets 
    WHERE id = ticket_id AND user_id = auth.uid()
  )
);

-- Super admins can send messages to any ticket
CREATE POLICY "Super admins can send messages"
ON public.support_messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id
  AND public.is_super_admin(auth.uid())
);

-- Create updated_at trigger for support_tickets
CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Create storage bucket for support screenshots
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-attachments', 'support-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for support attachments
CREATE POLICY "Users can upload support attachments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'support-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND public.has_role_or_higher(auth.uid(), 'shift_manager')
);

CREATE POLICY "Users can view their own support attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'support-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Super admins can view all support attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'support-attachments' 
  AND public.is_super_admin(auth.uid())
);

-- Enable realtime for support messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;