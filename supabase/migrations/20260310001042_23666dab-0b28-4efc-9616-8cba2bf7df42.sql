
ALTER TABLE public.inventory_counts 
ADD COLUMN is_late_close boolean NOT NULL DEFAULT false,
ADD COLUMN late_close_notes text;
