
ALTER TABLE public.inventory_count_items
ADD COLUMN entered_cases numeric DEFAULT NULL,
ADD COLUMN entered_units numeric DEFAULT NULL;
