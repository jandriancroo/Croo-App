
UPDATE public.inventory_product_groups
SET blueprint_id = sub.bp_id
FROM (
  SELECT pg.id AS pg_id, rb.id AS bp_id
  FROM public.inventory_product_groups pg
  JOIN public.bom_menu_items bmi ON bmi.id = pg.bom_menu_item_id
  JOIN public.recipe_blueprints rb 
    ON rb.name = COALESCE(bmi.clean_name, bmi.r365_name) 
    AND rb.location_id = pg.location_id 
    AND rb.is_active = true
  WHERE pg.bom_menu_item_id IS NOT NULL
) sub
WHERE public.inventory_product_groups.id = sub.pg_id
  AND public.inventory_product_groups.blueprint_id IS NULL;
