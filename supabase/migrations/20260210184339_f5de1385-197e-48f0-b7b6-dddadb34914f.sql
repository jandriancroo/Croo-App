
-- Add token caching columns to location_integrations
ALTER TABLE public.location_integrations 
ADD COLUMN IF NOT EXISTS cached_token_gw text,
ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
