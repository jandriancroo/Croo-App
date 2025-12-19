-- Add store numbers to locations
ALTER TABLE public.locations
ADD COLUMN IF NOT EXISTS store_number TEXT;

-- Optional uniqueness: store numbers must be unique within an organization (when provided)
CREATE UNIQUE INDEX IF NOT EXISTS locations_org_store_number_unique
ON public.locations (organization_id, store_number)
WHERE store_number IS NOT NULL;

-- Helpful index for lookup/search
CREATE INDEX IF NOT EXISTS locations_store_number_idx
ON public.locations (store_number);