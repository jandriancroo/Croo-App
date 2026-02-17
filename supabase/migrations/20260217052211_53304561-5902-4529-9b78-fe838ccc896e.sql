-- Add custom counting unit fields to inventory items
ALTER TABLE public.inventory_items
ADD COLUMN count_unit text DEFAULT null,
ADD COLUMN count_units_per_case numeric DEFAULT null;

COMMENT ON COLUMN public.inventory_items.count_unit IS 'The unit the user wants to enter usage rates in (e.g., oz, lb, ea, portions)';
COMMENT ON COLUMN public.inventory_items.count_units_per_case IS 'How many of count_unit fit in one case (e.g., 96 for 6lb case measured in oz)';