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