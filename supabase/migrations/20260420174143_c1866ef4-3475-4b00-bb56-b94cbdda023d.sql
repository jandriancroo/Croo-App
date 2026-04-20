UPDATE public.inventory_items
SET pack_quantity = count_units_per_case
WHERE pack_quantity IS NULL
  AND pack_quantity_override IS NULL
  AND count_units_per_case IS NOT NULL
  AND count_units_per_case > 1
  AND unit IN ('each','ea','can','bottle','unit','count');