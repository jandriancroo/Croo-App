ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS lens_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.locations.lens_enabled IS
  'Per-location gate for the brand_pack_configs lens read path. When false (default), approved configs are fully ignored at this store and valuation falls through to local pack/cost — byte-for-byte today''s behavior. Flip to true only after a config has been approved AND verified at this location.';