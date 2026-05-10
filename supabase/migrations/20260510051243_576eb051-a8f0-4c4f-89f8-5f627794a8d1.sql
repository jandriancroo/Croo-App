ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS inner_pack_quantity INTEGER NULL;

ALTER TABLE public.inventory_count_items
  ADD COLUMN IF NOT EXISTS entered_inner_packs INTEGER NULL,
  ADD COLUMN IF NOT EXISTS inner_pack_quantity_at_count INTEGER NULL;

COMMENT ON COLUMN public.inventory_items.inner_pack_quantity IS
  'Units per inner pack (sleeve/bundle/inner box). NULL = no inner-pack tier; counting collapses to Cases + Units.';

COMMENT ON COLUMN public.inventory_count_items.entered_inner_packs IS
  'Operator-entered inner pack count for this row. Source of truth alongside entered_cases / entered_units.';

COMMENT ON COLUMN public.inventory_count_items.inner_pack_quantity_at_count IS
  'Snapshot of inventory_items.inner_pack_quantity captured at save time. Mirrors pack_quantity_at_count for historical immutability.';