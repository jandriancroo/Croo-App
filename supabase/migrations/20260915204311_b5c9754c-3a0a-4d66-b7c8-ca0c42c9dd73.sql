ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS cost_zeroed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cost_zeroed_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.inventory_items.cost_zeroed_at IS 'Set when a person deliberately prices this item at zero. While set, the nightly price sync leaves cost_per_unit alone (all other fields still update). Cleared when a non-zero price is set.';
COMMENT ON COLUMN public.inventory_items.cost_zeroed_by IS 'Who deliberately zeroed the price.';