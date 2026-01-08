-- Remove deprecated labor columns from sales_cache
-- Labor data is now exclusively stored in labor_cache table

ALTER TABLE public.sales_cache 
  DROP COLUMN IF EXISTS labor_cost,
  DROP COLUMN IF EXISTS labor_hours,
  DROP COLUMN IF EXISTS regular_hours,
  DROP COLUMN IF EXISTS overtime_hours,
  DROP COLUMN IF EXISTS double_time_hours;