-- Phase 1a: Inventory Item Lifecycle — schema only, no behavior change

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS deactivated_by text,
  ADD COLUMN IF NOT EXISTS deactivated_reason text,
  ADD COLUMN IF NOT EXISTS last_seen_on_bid_list timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_on_bid_list_vendor text,
  ADD COLUMN IF NOT EXISTS available_since text,
  ADD COLUMN IF NOT EXISTS manually_activated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attention_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand_archived_at timestamptz;

-- Constrain deactivated_by to known sources (allows NULL for normal items)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_deactivated_by_check'
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_deactivated_by_check
      CHECK (deactivated_by IS NULL OR deactivated_by IN ('sync_auto', 'manager', 'brand_admin'));
  END IF;
END $$;

-- Constrain vendor source to known vendors
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_last_seen_vendor_check'
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_last_seen_vendor_check
      CHECK (last_seen_on_bid_list_vendor IS NULL OR last_seen_on_bid_list_vendor IN ('PFG', 'PA', 'Heimark'));
  END IF;
END $$;

-- Partial index for the Items-tab attention panel query
-- (rows where sync flagged something but manager hasn't deactivated)
CREATE INDEX IF NOT EXISTS idx_inventory_items_attention
  ON public.inventory_items (location_id)
  WHERE deactivated_reason IS NOT NULL AND deactivated_by IS NULL;

-- Index for sync upsert lookups
CREATE INDEX IF NOT EXISTS idx_inventory_items_last_seen
  ON public.inventory_items (location_id, last_seen_on_bid_list);

COMMENT ON COLUMN public.inventory_items.deactivated_by IS 'Phase 1a: who/what set deactivation state — sync_auto, manager, or brand_admin. NULL = active normal item.';
COMMENT ON COLUMN public.inventory_items.deactivated_reason IS 'Phase 1a: human-readable tag with timestamp shown in attention panel and inline.';
COMMENT ON COLUMN public.inventory_items.last_seen_on_bid_list IS 'Phase 1a: most recent successful vendor sync that found this item. Derive days_not_seen from now() - this value.';
COMMENT ON COLUMN public.inventory_items.last_seen_on_bid_list_vendor IS 'Phase 1a: PFG, PA, or Heimark — which vendor last confirmed availability.';
COMMENT ON COLUMN public.inventory_items.available_since IS 'Phase 1a: reappearance message shown when item returns to a bid list.';
COMMENT ON COLUMN public.inventory_items.manually_activated IS 'Phase 1a: TRUE when manager deliberately reactivated — sync will not flag again.';
COMMENT ON COLUMN public.inventory_items.attention_acknowledged IS 'Phase 1a: TRUE when manager tapped "Got it" on a brand-deactivation notice.';
COMMENT ON COLUMN public.inventory_items.brand_archived_at IS 'Phase 1a: timestamp when brand archived this item — drives "Archived by brand" gray tag.';