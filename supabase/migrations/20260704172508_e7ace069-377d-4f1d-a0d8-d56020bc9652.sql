
-- Opt-in dual counting (case + inner unit) for Lite inventory. No behavior change for
-- existing items: count_mode defaults to 'single'. Operator must explicitly enable
-- 'case_and_unit' per item via the edit sheet.
ALTER TABLE public.lite_inventory_items
  ADD COLUMN IF NOT EXISTS count_mode text NOT NULL DEFAULT 'single'
    CHECK (count_mode IN ('single','case_and_unit')),
  ADD COLUMN IF NOT EXISTS case_qty integer,
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS cost_per_inner_unit numeric(12,4);

COMMENT ON COLUMN public.lite_inventory_items.count_mode IS
  'single = one stepper (quantity); case_and_unit = two steppers (cases + inner units). Opt-in per item.';
COMMENT ON COLUMN public.lite_inventory_items.case_qty IS
  'How many inner units are in one case (only used when count_mode = case_and_unit).';
COMMENT ON COLUMN public.lite_inventory_items.unit_label IS
  'Human label for the inner unit shown on the second stepper (e.g. "1 LB Pack"). Only used when count_mode = case_and_unit.';
COMMENT ON COLUMN public.lite_inventory_items.cost_per_inner_unit IS
  'Operator override for the inner-unit cost. If NULL, UI falls back to cost_per_unit / case_qty at count-snapshot time.';

-- Count-row snapshot fields. Mirrors the immutability pattern used for
-- unit_value_at_count / storage_id_at_count today: future item edits must never
-- rewrite historical counts.
ALTER TABLE public.lite_inventory_count_items
  ADD COLUMN IF NOT EXISTS case_quantity numeric(12,3),
  ADD COLUMN IF NOT EXISTS inner_quantity numeric(12,3),
  ADD COLUMN IF NOT EXISTS count_mode_at_count text NOT NULL DEFAULT 'single'
    CHECK (count_mode_at_count IN ('single','case_and_unit')),
  ADD COLUMN IF NOT EXISTS case_qty_at_count integer,
  ADD COLUMN IF NOT EXISTS unit_label_at_count text,
  ADD COLUMN IF NOT EXISTS cost_per_inner_unit_at_count numeric(12,4);

COMMENT ON COLUMN public.lite_inventory_count_items.case_quantity IS
  'Cases counted (dual mode only). Null/0 for single-mode rows.';
COMMENT ON COLUMN public.lite_inventory_count_items.inner_quantity IS
  'Inner units counted (dual mode only). Null/0 for single-mode rows.';
COMMENT ON COLUMN public.lite_inventory_count_items.count_mode_at_count IS
  'Snapshot of item.count_mode at time of count — locks the row into its counting shape.';
