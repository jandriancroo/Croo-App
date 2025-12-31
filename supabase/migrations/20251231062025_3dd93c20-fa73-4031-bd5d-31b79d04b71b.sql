-- Add first_login_at column to track when users first log in
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add invited_by column to track who invited the user
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id) DEFAULT NULL;