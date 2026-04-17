-- Wipe Palm Desert (location_id: 01a87b8b-fb29-4734-8d1b-4a47307f843c) inventory clean
-- This is a controlled reset before re-deploying with the new structure-only flow.
-- Safe: 0 inventory_counts exist for this location, so no historical data is lost.

DELETE FROM public.brand_inventory_deployments
WHERE location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c';

DELETE FROM public.inventory_items
WHERE location_id = '01a87b8b-fb29-4734-8d1b-4a47307f843c';

UPDATE public.locations
SET last_deployed_at = NULL
WHERE id = '01a87b8b-fb29-4734-8d1b-4a47307f843c';