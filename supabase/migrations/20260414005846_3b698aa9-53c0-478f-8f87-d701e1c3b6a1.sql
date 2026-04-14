-- Set all Beer/Wine brand templates to count by each, 1 per case
UPDATE public.brand_inventory_templates
SET count_unit = 'ea',
    count_units_per_case = 1,
    updated_at = now()
WHERE category = 'Beer/Wine'
  AND status = 'active';