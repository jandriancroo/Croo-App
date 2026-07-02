-- Restore the 5 perturbed items
UPDATE public.lite_inventory_items
SET name = REGEXP_REPLACE(name, ' ZZ$', ''),
    item_number = REGEXP_REPLACE(item_number, '^X-', ''),
    vendor_name_normalized = 'performance foodservice'
WHERE id IN (
  'a3081a7b-9f6b-448c-8885-27a111ba815c',
  'b801fba9-6488-4c29-9773-43b1acd5fa9b',
  'da8621f8-d052-4cae-8307-4592a9d88f5e',
  '02edfd44-0fa0-415b-bafd-1d79b6e1a0a9',
  '476fc253-a482-4ee2-83a6-860449cd5802'
);

-- Delete all Lite QA test invoices (cascades line items)
DELETE FROM public.lite_vendor_invoices
WHERE location_id = '9a5c1e00-0000-4000-8000-000000000002';