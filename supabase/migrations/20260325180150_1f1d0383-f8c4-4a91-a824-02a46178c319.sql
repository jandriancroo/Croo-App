
-- FIX HERBIVORE CORE BLUEPRINTS

-- LARGE HERBIVORE (0460fe5f): Remove duplicate Banana Peppers (no source_name)
DELETE FROM recipe_blueprint_ingredients WHERE id = '8c285785-6deb-49af-b58d-f3460a4f127a';

-- LARGE HERBIVORE: Add Un-Roasted Garlic 2.0 oz
INSERT INTO recipe_blueprint_ingredients (blueprint_id, ingredient_type, vendor_item_id, quantity, unit, source_name)
VALUES ('0460fe5f-f7be-41c7-9aae-1d96702621e4', 'vendor_item', 'c4196b76-042f-4866-b4c7-e83031625164', 2.0, 'OZ-wt', 'garlic roasted');

-- REGULAR HERBIVORE (208d1ba3): Remove duplicate Shredded Mozz
DELETE FROM recipe_blueprint_ingredients WHERE id = '74b400f6-7bc7-47ec-ad50-0030dcb6cbef';

-- REGULAR HERBIVORE: Remove duplicate Banana Peppers (no source_name)
DELETE FROM recipe_blueprint_ingredients WHERE id = '3e864db3-1dc1-433d-9757-938703058e5f';

-- REGULAR HERBIVORE: Add Un-Roasted Garlic 1.0 oz
INSERT INTO recipe_blueprint_ingredients (blueprint_id, ingredient_type, vendor_item_id, quantity, unit, source_name)
VALUES ('208d1ba3-1955-4d89-93ab-8b361cd91498', 'vendor_item', 'c4196b76-042f-4866-b4c7-e83031625164', 1.0, 'OZ-wt', 'garlic roasted');

-- REGULAR HERBIVORE: Add Spicy Sauce 2.5 oz
INSERT INTO recipe_blueprint_ingredients (blueprint_id, ingredient_type, vendor_item_id, quantity, unit, source_name)
VALUES ('208d1ba3-1955-4d89-93ab-8b361cd91498', 'vendor_item', 'de143fa3-134d-4fa1-b2e7-6a37de778e07', 2.5, 'OZ-wt', 'spicy pizza sauce');
