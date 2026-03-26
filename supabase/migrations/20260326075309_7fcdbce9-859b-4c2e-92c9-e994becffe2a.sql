
-- Fix half pizza BASE: remove duplicate rows
DELETE FROM recipe_blueprint_ingredients WHERE id = '82bc48d2-6441-406a-ba6f-521ff7aeba06';
DELETE FROM recipe_blueprint_ingredients WHERE id = '086408f0-a228-467d-bab5-b737e6b48b13';

-- Add Napkin (1 ea) to half pizza BASE
INSERT INTO recipe_blueprint_ingredients (blueprint_id, ingredient_type, vendor_item_id, quantity, unit)
SELECT rb.id, 'vendor_item', '3f7cdfd7-fa14-43df-91f0-3bdf999e1b13', 1, 'Each'
FROM recipe_blueprints rb
WHERE rb.name = 'half pizza' AND rb.category = 'BASE' AND rb.location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6';
