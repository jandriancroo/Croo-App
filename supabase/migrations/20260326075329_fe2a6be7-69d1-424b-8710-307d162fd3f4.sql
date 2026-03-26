
-- Add 1/2 Pizza Box (0.5 ea) to half pizza BASE
INSERT INTO recipe_blueprint_ingredients (blueprint_id, ingredient_type, vendor_item_id, quantity, unit)
SELECT rb.id, 'vendor_item', '894d0262-2c25-426f-a335-a72625da2b5a', 0.5, 'Each'
FROM recipe_blueprints rb
WHERE rb.name = 'half pizza' AND rb.category = 'BASE' AND rb.location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6';
