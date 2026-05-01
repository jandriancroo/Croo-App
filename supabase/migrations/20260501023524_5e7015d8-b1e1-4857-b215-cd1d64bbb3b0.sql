CREATE UNIQUE INDEX IF NOT EXISTS inventory_counts_unique_active_period
ON public.inventory_counts (location_id, period_type, period_end_date)
WHERE status IN ('in_progress', 'completed');