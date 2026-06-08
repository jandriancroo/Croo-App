-- Tighten source_evidence on brand_pack_configs so every row carries a structured audit blob.
-- Existing rows: backfill NULL -> '{}'. Going forward: NOT NULL DEFAULT '{}'.
UPDATE public.brand_pack_configs
SET source_evidence = '{}'::jsonb
WHERE source_evidence IS NULL;

ALTER TABLE public.brand_pack_configs
  ALTER COLUMN source_evidence SET DEFAULT '{}'::jsonb,
  ALTER COLUMN source_evidence SET NOT NULL;