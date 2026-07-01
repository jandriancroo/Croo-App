ALTER TABLE public.brand_inventory_templates
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brand_inventory_templates.is_free IS
  'When true, this ingredient is intentionally $0 (e.g. Water, Ice, Tap Water). Cost engines must treat $0 as a valid price and NOT flag the recipe as unpriced/partial.';

-- Seed obvious free ingredients by name
UPDATE public.brand_inventory_templates
   SET is_free = true
 WHERE is_free = false
   AND (
     lower(coalesce(common_name, '')) IN ('water','ice','tap water','filtered water','hot water','cold water')
     OR lower(coalesce(product_name, '')) IN ('water','ice','tap water','filtered water','hot water','cold water')
   );