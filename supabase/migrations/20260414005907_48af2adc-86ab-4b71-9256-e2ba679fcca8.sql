UPDATE public.inventory_items ii
SET count_unit = 'ea',
    count_units_per_case = 1
FROM public.brand_inventory_templates bt
WHERE ii.brand_item_id = bt.id
  AND bt.category = 'Beer/Wine'
  AND ii.is_active = true
  AND (ii.count_unit IS NULL OR ii.count_units_per_case IS NULL);