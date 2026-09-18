ALTER TABLE public.pfg_orders
  ADD COLUMN IF NOT EXISTS detail_error text;

-- Backfill: split comma/semicolon/slash/pipe-joined item numbers into one row per
-- real PFG number, carrying the source row's price, description, pack and category.
INSERT INTO public.pfg_bid_items (
  location_id, item_number, description, pack_size, category, brand_name, unit_price, last_seen_at
)
SELECT b.location_id,
       trim(tok) AS item_number,
       b.description, b.pack_size, b.category, b.brand_name, b.unit_price, b.last_seen_at
FROM public.pfg_bid_items b
CROSS JOIN LATERAL regexp_split_to_table(b.item_number, '[,;/|]+') AS tok
WHERE b.item_number ~ '[,;/|]'
  AND trim(tok) <> ''
ON CONFLICT (location_id, item_number) DO UPDATE SET
  description = COALESCE(EXCLUDED.description, pfg_bid_items.description),
  pack_size   = COALESCE(EXCLUDED.pack_size,   pfg_bid_items.pack_size),
  category    = COALESCE(EXCLUDED.category,    pfg_bid_items.category),
  brand_name  = COALESCE(EXCLUDED.brand_name,  pfg_bid_items.brand_name),
  unit_price  = COALESCE(pfg_bid_items.unit_price, EXCLUDED.unit_price);

DELETE FROM public.pfg_bid_items WHERE item_number ~ '[,;/|]';