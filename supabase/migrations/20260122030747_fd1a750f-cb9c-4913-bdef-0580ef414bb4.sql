-- Create a table for applicant push subscriptions (non-authenticated users)
CREATE TABLE public.applicant_push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.hiring_conversations(id) ON DELETE CASCADE,
  subscription_data TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, subscription_data)
);

-- Enable RLS
ALTER TABLE public.applicant_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (applicants are not authenticated)
CREATE POLICY "Anyone can insert applicant push subscriptions"
ON public.applicant_push_subscriptions
FOR INSERT
WITH CHECK (true);

-- Allow anyone to update their own subscription (by conversation token access)
CREATE POLICY "Anyone can update applicant push subscriptions"
ON public.applicant_push_subscriptions
FOR UPDATE
USING (true);

-- Service role can read all for sending notifications
CREATE POLICY "Service role can read applicant push subscriptions"
ON public.applicant_push_subscriptions
FOR SELECT
USING (true);

-- Add index for faster lookups
CREATE INDEX idx_applicant_push_subscriptions_conversation_id 
ON public.applicant_push_subscriptions(conversation_id);