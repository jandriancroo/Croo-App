-- Clean up duplicated Lite invoice lines from repeated re-parses.
-- Keep the most recent copy of each (invoice_id, product_name, item_number) group.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY invoice_id, product_name, coalesce(item_number, ''), coalesce(unit_price::text, '')
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.lite_vendor_invoice_items
)
DELETE FROM public.lite_vendor_invoice_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Restore the full vendor name that was clobbered by a shorter re-parse value.
UPDATE public.lite_vendor_invoices
SET vendor_name = 'McLane Foodservice, Inc.'
WHERE vendor_name = 'MCLANE';