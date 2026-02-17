-- Add category column to inventory items
ALTER TABLE public.inventory_items ADD COLUMN category text;

-- Add last_synced_at to track PFG freshness (for future stale detection)
ALTER TABLE public.inventory_items ADD COLUMN last_synced_at timestamptz;