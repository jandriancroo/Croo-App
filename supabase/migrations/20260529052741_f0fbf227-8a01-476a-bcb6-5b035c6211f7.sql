-- Step 4: Codified dedupe guard for proposed brand_pack_configs
-- Mirrors uniq_brand_pack_configs_approved_structure but for status='proposed'.
-- The May 28 ad-hoc cleanup + seeder patch already collapsed duplicates,
-- so the archive step below is expected to affect 0 rows today.

-- 1. Archive any remaining duplicate proposed rows (keep oldest per structure)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY brand_template_id, outer_qty, COALESCE(inner_qty, 0), common_unit
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.brand_pack_configs
  WHERE status = 'proposed'
)
UPDATE public.brand_pack_configs
SET status = 'archived',
    updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Permanent uniqueness guard for proposed rows
CREATE UNIQUE INDEX IF NOT EXISTS uniq_brand_pack_configs_proposed_structure
ON public.brand_pack_configs
  USING btree (brand_template_id, outer_qty, COALESCE(inner_qty, (0)::numeric), common_unit)
WHERE (status = 'proposed');