
-- 1. archived_at column
ALTER TABLE public.brand_inventory_templates
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- 2. Drop stale bucket selections (real meatballs selections already exist for all 5 locations)
DELETE FROM public.location_pack_selections
WHERE brand_template_id = 'b1d5de61-2b2e-46ce-b253-83de33ab03b3';

-- 3a. Archive bucket pack config
UPDATE public.brand_pack_configs
SET status = 'archived', updated_at = now()
WHERE id = 'ec868a91-54d6-427b-abd9-95ac1e025f72';

-- 3b. Archive bucket template
UPDATE public.brand_inventory_templates
SET status = 'archived', archived_at = now(), updated_at = now()
WHERE id = 'b1d5de61-2b2e-46ce-b253-83de33ab03b3';

-- 4. vendor_sku_health seeds
INSERT INTO public.vendor_sku_health
  (brand_id, vendor_source, vendor_sku, status, product_name, first_seen_at, last_seen_at, last_seen_on_bid_list)
VALUES
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'pfg', '851425', 'discontinued',
   '16oz Short Bucket (mislabeled "Meatball Bucket")',
   now(), '2026-06-13'::timestamptz, '2026-06-13'::timestamptz),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'pfg', '218001', 'active',
   'Meatball Bucket Lid',
   now(), now(), now());
