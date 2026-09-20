-- Clear bogus item_number on produce_alliance rows (Blaze has no cross-vendor items by design).
-- Only touches active rows carrying BOTH identifiers, except the verified real PFG number 611957.
UPDATE public.inventory_items
SET item_number = NULL
WHERE is_active
  AND pa_item_id IS NOT NULL
  AND item_number IS NOT NULL
  AND item_number <> ''
  AND item_number <> '611957'
  -- Safety: never clear a number that exists on any PFG bid guide or PFG brand mapping.
  AND NOT EXISTS (SELECT 1 FROM public.pfg_bid_items p WHERE p.item_number = inventory_items.item_number)
  AND NOT EXISTS (SELECT 1 FROM public.brand_vendor_mappings m WHERE m.vendor = 'pfg' AND m.vendor_item_id = inventory_items.item_number);