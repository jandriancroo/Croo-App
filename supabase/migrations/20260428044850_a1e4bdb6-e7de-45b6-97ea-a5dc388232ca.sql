ALTER TABLE public.inventory_count_items
  ADD COLUMN IF NOT EXISTS pack_quantity_at_count numeric,
  ADD COLUMN IF NOT EXISTS pan_sizes_at_count jsonb;