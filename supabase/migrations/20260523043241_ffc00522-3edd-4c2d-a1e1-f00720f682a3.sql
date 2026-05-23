-- Numeric migration for fractional inner-pack quantities (e.g. 6/2.5 KG)
-- Preserves all existing data; integers cast cleanly to numeric.

-- 1. Drop dependent unique index that references inner_qty
DROP INDEX IF EXISTS public.uniq_brand_pack_configs_approved_structure;

-- 2. brand_pack_configs.inner_qty -> numeric
ALTER TABLE public.brand_pack_configs
  ALTER COLUMN inner_qty TYPE numeric USING inner_qty::numeric;

-- 3. Recreate unique index (same shape, now numeric-safe)
CREATE UNIQUE INDEX uniq_brand_pack_configs_approved_structure
  ON public.brand_pack_configs
  USING btree (brand_template_id, outer_qty, COALESCE(inner_qty, 0), common_unit)
  WHERE (status = 'approved'::text);

-- 4. inventory_items.inner_pack_quantity -> numeric + new label column
ALTER TABLE public.inventory_items
  ALTER COLUMN inner_pack_quantity TYPE numeric USING inner_pack_quantity::numeric,
  ADD COLUMN IF NOT EXISTS inner_pack_label text;

COMMENT ON COLUMN public.inventory_items.inner_pack_label IS
  'Human-readable middle-tier label rendered in the count UI (e.g. "bag", "sleeve", "bundle"). Null = generic "Packs".';

-- 5. inventory_count_items.inner_pack_quantity_at_count -> numeric (snapshot consistency)
ALTER TABLE public.inventory_count_items
  ALTER COLUMN inner_pack_quantity_at_count TYPE numeric USING inner_pack_quantity_at_count::numeric;