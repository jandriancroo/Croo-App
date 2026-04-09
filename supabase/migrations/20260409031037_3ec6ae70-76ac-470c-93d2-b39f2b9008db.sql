ALTER TABLE public.ovation_integrations
ADD COLUMN IF NOT EXISTS cognito_username TEXT,
ADD COLUMN IF NOT EXISTS cognito_password TEXT;