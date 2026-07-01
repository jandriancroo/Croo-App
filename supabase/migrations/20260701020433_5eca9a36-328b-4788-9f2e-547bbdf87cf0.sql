
ALTER TABLE public.brand_pack_configs
  ADD COLUMN IF NOT EXISTS show_cases boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_inner_packs boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_common_unit boolean NOT NULL DEFAULT false;

-- Backfill: match today's approval-screen defaults
UPDATE public.brand_pack_configs
SET show_cases = true,
    show_inner_packs = COALESCE(inner_qty, 0) > 1,
    show_common_unit = false;
