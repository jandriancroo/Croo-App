-- Perturb 5 lite items so composite miss + exact-name miss + fuzzy hit
UPDATE public.lite_inventory_items
SET name = name || ' ZZ',
    vendor_name_normalized = NULL,
    item_number = 'X-' || item_number
WHERE id IN (
  'a3081a7b-9f6b-448c-8885-27a111ba815c',
  'b801fba9-6488-4c29-9773-43b1acd5fa9b',
  'da8621f8-d052-4cae-8307-4592a9d88f5e',
  '02edfd44-0fa0-415b-bafd-1d79b6e1a0a9',
  '476fc253-a482-4ee2-83a6-860449cd5802'
);

-- Clean up orphan pending invoice from a Test A retry
DELETE FROM public.lite_vendor_invoices
WHERE id = 'a330fb2e-39f4-4730-a932-5b9fab409adf'
  AND status = 'pending'
  AND parsed_at IS NULL;