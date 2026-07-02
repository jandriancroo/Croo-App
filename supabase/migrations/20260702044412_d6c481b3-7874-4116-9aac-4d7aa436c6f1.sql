INSERT INTO public.inventory_items (id, location_id, name, item_number, vendor_name_normalized, cost_per_unit, is_active, match_status)
VALUES
  ('9a5c1e00-1111-4000-8000-000000000001', '9a5c1e00-0000-4000-8000-000000000002',
   'Whole Milk Gallon', 'SYY-12345', 'sysco', 3.99, true, 'matched'),
  ('9a5c1e00-1111-4000-8000-000000000002', '9a5c1e00-0000-4000-8000-000000000002',
   'Romaine Lettuce 24ct', NULL, 'sysco', 22.50, true, 'matched')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.vendor_invoices (id, location_id, vendor_name, invoice_number, invoice_date, total_amount, status, parsed_at)
VALUES ('9a5c1e00-2222-4000-8000-000000000001', '9a5c1e00-0000-4000-8000-000000000002',
  'Sysco', 'QA-SMOKE-001', CURRENT_DATE, 187.42, 'parsed', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.vendor_invoice_items
  (invoice_id, product_name, item_number, quantity, unit, unit_price, total_price, match_status, matched_item_id)
VALUES ('9a5c1e00-2222-4000-8000-000000000001', 'Whole Milk Gal', 'SYY-12345', 4, 'gal', 4.19, 16.76,
  'matched', '9a5c1e00-1111-4000-8000-000000000001');

INSERT INTO public.vendor_invoice_items
  (invoice_id, product_name, item_number, quantity, unit, unit_price, total_price, match_status, matched_item_id)
VALUES ('9a5c1e00-2222-4000-8000-000000000001', 'Romaine Lettuce 24ct', NULL, 2, 'case', 24.00, 48.00,
  'matched', '9a5c1e00-1111-4000-8000-000000000002');

INSERT INTO public.vendor_invoice_items
  (invoice_id, product_name, item_number, quantity, unit, unit_price, total_price, match_status, candidate_item_id)
VALUES ('9a5c1e00-2222-4000-8000-000000000001', 'Romaine Lettuce, 24 count', NULL, 1, 'case', 23.75, 23.75,
  'fuzzy', '9a5c1e00-1111-4000-8000-000000000002');

WITH new_item AS (
  INSERT INTO public.inventory_items
    (location_id, name, item_number, vendor_name_normalized, cost_per_unit, is_active, match_status)
  VALUES ('9a5c1e00-0000-4000-8000-000000000002', 'Shredded Mozzarella 5#',
     'SYY-99881', 'sysco', 14.22, true, 'new')
  RETURNING id
)
INSERT INTO public.vendor_invoice_items
  (invoice_id, product_name, item_number, quantity, unit, unit_price, total_price, match_status, matched_item_id)
SELECT '9a5c1e00-2222-4000-8000-000000000001', 'Shredded Mozzarella 5#', 'SYY-99881', 7, 'bag', 14.22, 99.54,
  'new', id FROM new_item;

UPDATE public.inventory_items SET cost_per_unit = 4.19
  WHERE id = '9a5c1e00-1111-4000-8000-000000000001';