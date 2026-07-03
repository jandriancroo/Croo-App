
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS inventory_configured boolean NOT NULL DEFAULT false;

-- Backfill: mark as configured if mode was explicitly 'lite' (non-default),
-- or if the location already has any inventory items in either system.
UPDATE public.locations l
SET inventory_configured = true
WHERE inventory_configured = false
  AND (
    l.inventory_mode = 'lite'
    OR EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.location_id = l.id LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.lite_inventory_items li WHERE li.location_id = l.id LIMIT 1)
  );
