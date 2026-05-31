BEGIN;

-- Ensure source column exists on snapshot_backfill_log
ALTER TABLE public.snapshot_backfill_log
  ADD COLUMN IF NOT EXISTS source TEXT;

-- ============================================================
-- PASS 1: Fix parent pack_quantity_at_count on multi-config items
-- ============================================================
WITH targets AS (
  SELECT
    ci.id AS count_item_id,
    ci.count_id,
    ci.item_id,
    ci.pack_quantity_at_count AS old_pack_qty,
    default_bpc.count_units_per_case AS new_pack_qty,
    c.location_id
  FROM inventory_count_items ci
  JOIN inventory_counts c ON c.id = ci.count_id
  JOIN inventory_items ii ON ii.id = ci.item_id
  JOIN location_pack_selections default_lps
    ON default_lps.location_id = c.location_id
   AND default_lps.brand_template_id = ii.brand_item_id
   AND default_lps.is_default = true
  JOIN brand_pack_configs default_bpc
    ON default_bpc.id = default_lps.active_pack_config_id
  WHERE c.status != 'in_progress'
    AND ii.brand_item_id IS NOT NULL
    AND ci.pack_quantity_at_count IS DISTINCT FROM default_bpc.count_units_per_case
    AND EXISTS (
      SELECT 1 FROM location_pack_selections lps2
      WHERE lps2.location_id = c.location_id
        AND lps2.brand_template_id = ii.brand_item_id
      GROUP BY lps2.location_id, lps2.brand_template_id
      HAVING COUNT(*) >= 2
    )
),
logged AS (
  INSERT INTO public.snapshot_backfill_log
    (count_id, item_id, location_id, old_pack_qty, new_pack_qty, source)
  SELECT count_id, item_id, location_id, old_pack_qty, new_pack_qty, 'leg_backfill_2026_05_pass1'
  FROM targets
  RETURNING 1
)
UPDATE inventory_count_items ci
SET pack_quantity_at_count = t.new_pack_qty
FROM targets t
WHERE ci.id = t.count_item_id;

-- ============================================================
-- PASS 2: Leg structural snapshots (pack_quantity + inner_pack_quantity)
-- ============================================================
WITH targets AS (
  SELECT
    l.id AS leg_id,
    l.count_item_id,
    ci.count_id,
    ci.item_id,
    c.location_id,
    l.pack_quantity_at_count AS old_pack_qty,
    bpc.count_units_per_case AS new_pack_qty,
    bpc.inner_qty AS new_inner_qty
  FROM inventory_count_item_legs l
  JOIN inventory_count_items ci ON ci.id = l.count_item_id
  JOIN inventory_counts c ON c.id = ci.count_id
  JOIN brand_pack_configs bpc ON bpc.id = l.pack_config_id
  WHERE c.status != 'in_progress'
    AND (l.pack_quantity_at_count IS NULL OR l.inner_pack_quantity_at_count IS NULL)
),
logged AS (
  INSERT INTO public.snapshot_backfill_log
    (count_id, item_id, location_id, old_pack_qty, new_pack_qty, source)
  SELECT count_id, item_id, location_id, old_pack_qty, new_pack_qty, 'leg_backfill_2026_05_pass2'
  FROM targets
  RETURNING 1
)
UPDATE inventory_count_item_legs l
SET pack_quantity_at_count = t.new_pack_qty,
    inner_pack_quantity_at_count = t.new_inner_qty
FROM targets t
WHERE l.id = t.leg_id;

-- ============================================================
-- PASS 3: Leg cost snapshots on submitted counts
-- cost = leg.count_units_per_case × (parent.cost_at_count / default.count_units_per_case)
-- ============================================================
WITH targets AS (
  SELECT
    l.id AS leg_id,
    l.count_item_id,
    ci.count_id,
    ci.item_id,
    c.location_id,
    l.cost_at_count AS old_cost,
    (leg_bpc.count_units_per_case
      * (ci.cost_at_count / NULLIF(default_bpc.count_units_per_case, 0)))::numeric AS new_cost
  FROM inventory_count_item_legs l
  JOIN inventory_count_items ci ON ci.id = l.count_item_id
  JOIN inventory_counts c ON c.id = ci.count_id
  JOIN inventory_items ii ON ii.id = ci.item_id
  JOIN brand_pack_configs leg_bpc ON leg_bpc.id = l.pack_config_id
  JOIN location_pack_selections default_lps
    ON default_lps.location_id = c.location_id
   AND default_lps.brand_template_id = ii.brand_item_id
   AND default_lps.is_default = true
  JOIN brand_pack_configs default_bpc
    ON default_bpc.id = default_lps.active_pack_config_id
  WHERE c.status != 'in_progress'
    AND l.cost_at_count IS NULL
    AND ci.cost_at_count IS NOT NULL
    AND ci.cost_at_count > 0
    AND default_bpc.count_units_per_case > 0
),
logged AS (
  INSERT INTO public.snapshot_backfill_log
    (count_id, item_id, location_id, old_cost, new_cost, source)
  SELECT count_id, item_id, location_id, old_cost, new_cost, 'leg_backfill_2026_05_pass3'
  FROM targets
  RETURNING 1
)
UPDATE inventory_count_item_legs l
SET cost_at_count = t.new_cost
FROM targets t
WHERE l.id = t.leg_id;

COMMIT;