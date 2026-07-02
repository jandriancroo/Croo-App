CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Tenant mode on locations
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS inventory_mode text NOT NULL DEFAULT 'brand';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_inventory_mode_check'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT locations_inventory_mode_check
      CHECK (inventory_mode IN ('brand', 'lite'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_locations_inventory_mode
  ON public.locations(inventory_mode)
  WHERE inventory_mode = 'lite';

COMMENT ON COLUMN public.locations.inventory_mode IS
  'Tenant tier: brand = full inventory (templates, pack config, recipes); lite = invoice check-in + flat counts only. Set at creation, not editable in v1.';

-- 2. Helper columns on inventory_items for Lite matcher
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS vendor_name_normalized text,
  ADD COLUMN IF NOT EXISTS match_status text;

CREATE INDEX IF NOT EXISTS idx_inventory_items_lite_composite
  ON public.inventory_items(location_id, vendor_name_normalized, item_number)
  WHERE brand_item_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_name_trgm
  ON public.inventory_items USING gin (name gin_trgm_ops)
  WHERE brand_item_id IS NULL;

COMMENT ON COLUMN public.inventory_items.vendor_name_normalized IS
  'Lowercased/trimmed vendor name; populated for Lite-created items to power composite (vendor, item_number) matching.';
COMMENT ON COLUMN public.inventory_items.match_status IS
  'Lite-only provenance: matched | fuzzy | new. NULL for brand-mode items.';

-- 3. Helper column on vendor_invoice_items for Phase 2 check-in UI
-- (match_status already exists on this table with default 'unmatched'; brand rows keep using that value)
ALTER TABLE public.vendor_invoice_items
  ADD COLUMN IF NOT EXISTS candidate_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.vendor_invoice_items.candidate_item_id IS
  'Set only when match_status = fuzzy; Phase 2 check-in UI uses this to prompt user to confirm/reject the fuzzy match.';