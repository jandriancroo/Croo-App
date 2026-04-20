CREATE TABLE IF NOT EXISTS public.inventory_count_items_backup_20260420 AS
SELECT * FROM public.inventory_count_items
WHERE count_id = (
  SELECT id FROM public.inventory_counts
  WHERE location_id = 'd667741f-6d4c-433e-bb22-307e817ea7f1'
    AND period_end_date = '2026-04-19'
  LIMIT 1
);