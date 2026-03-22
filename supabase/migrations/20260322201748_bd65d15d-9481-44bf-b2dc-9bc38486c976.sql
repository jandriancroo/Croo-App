
UPDATE recipe_blueprint_ingredients rbi
SET source_name = matched.clean_name
FROM (
  SELECT rb2.id as blueprint_id, bri.quantity, bri.unit_of_measure, bi.clean_name
  FROM recipe_blueprints rb2
  JOIN bom_menu_items bmi ON UPPER(bmi.r365_name) = UPPER(rb2.r365_name) AND bmi.location_id = rb2.location_id
  JOIN bom_recipe_ingredients bri ON bri.menu_item_id = bmi.id
  JOIN bom_ingredients bi ON bi.id = bri.ingredient_id
) matched
WHERE rbi.blueprint_id = matched.blueprint_id
  AND rbi.vendor_item_id IS NULL
  AND rbi.sub_blueprint_id IS NULL
  AND rbi.source_name IS NULL
  AND rbi.quantity = matched.quantity
  AND UPPER(rbi.unit) = UPPER(matched.unit_of_measure);
