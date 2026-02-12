
-- Create bounced_emails table to track permanently rejected addresses
CREATE TABLE IF NOT EXISTS public.bounced_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email_address TEXT NOT NULL UNIQUE,
  bounce_reason TEXT,
  first_bounced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  bounced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  bounce_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bounced_emails ENABLE ROW LEVEL SECURITY;

-- Allow service role to read/write (system-only table)
CREATE POLICY "Service role only" 
ON public.bounced_emails 
FOR ALL 
USING (false)
WITH CHECK (false);

-- Create index for email lookups
CREATE INDEX idx_bounced_emails_email ON public.bounced_emails(email_address);
