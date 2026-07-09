ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- Backfill existing system-generated tickets
UPDATE public.support_tickets
SET is_system = true
WHERE is_system = false
  AND (
    description LIKE '[pfg-chain-broken:%'
    OR description LIKE '%System Alert: PFG integration%'
    OR description LIKE 'Automated PA login failed%'
    OR description LIKE '%Generated automatically by%'
  );