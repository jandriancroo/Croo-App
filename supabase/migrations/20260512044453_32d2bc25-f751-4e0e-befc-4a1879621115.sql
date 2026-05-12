-- Fix #1: Normalize Hemet's Classic Red Sauce (Prepped) to match brand standard
UPDATE public.inventory_items
SET unit = 'each',
    cost_per_unit = NULL
WHERE id = 'dde2a7bf-450e-4267-8820-84ee81cda75f';

-- Fix #2: Rename stale legacy "OLD" recipe records so they stop polluting brand-name searches
UPDATE public.inventory_items
SET name = '[ARCHIVED] ' || name
WHERE is_active = false
  AND (
    name ILIKE 'Classic Red Sauce OLD%'
    OR name ILIKE 'classic prep red sauce%'
  )
  AND name NOT ILIKE '[ARCHIVED]%';