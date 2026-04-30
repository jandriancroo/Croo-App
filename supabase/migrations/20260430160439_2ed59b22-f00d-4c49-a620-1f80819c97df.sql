UPDATE inventory_count_items ci
SET pack_quantity_at_count = NULL
FROM inventory_counts cnt
WHERE ci.count_id = cnt.id
  AND cnt.period_end_date < '2026-04-28';