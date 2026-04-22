ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS days_not_seen integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.inventory_items.days_not_seen IS
  'Mirrored from vendor_sku_health by inventory-availability-sweep. Number of consecutive sweeps this item has been missing from its vendor''s current bid list. 0 = currently on bid list.';