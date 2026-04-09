ALTER TABLE public.ovation_location_mappings
  ADD COLUMN IF NOT EXISTS cognito_username text,
  ADD COLUMN IF NOT EXISTS cognito_password text,
  ADD COLUMN IF NOT EXISTS auth_token text,
  ADD COLUMN IF NOT EXISTS token_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_id text;