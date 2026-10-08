-- Order history rows by real time even when several edits share one transaction.
ALTER TABLE public.schedule_change_log ALTER COLUMN created_at SET DEFAULT clock_timestamp();