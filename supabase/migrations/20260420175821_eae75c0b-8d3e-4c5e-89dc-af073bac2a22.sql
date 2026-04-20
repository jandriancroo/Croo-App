UPDATE inventory_count_items ici
SET quantity = (
  COALESCE(ici.entered_cases, 0)
  * COALESCE(ii.pack_quantity_override, ii.pack_quantity, 1)
) + COALESCE(ici.entered_units, 0)
FROM inventory_items ii
WHERE ici.item_id = ii.id
  AND ici.count_id = '6cf8178e-c921-4b4d-9b60-19143efff616'
  AND (COALESCE(ici.entered_cases, 0) > 0 OR COALESCE(ici.entered_units, 0) > 0);