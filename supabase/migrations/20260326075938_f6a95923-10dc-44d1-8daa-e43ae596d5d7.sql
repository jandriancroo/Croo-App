
-- Deactivate discontinued COREs and their related MI/PREP blueprints
UPDATE recipe_blueprints SET is_active = false
WHERE id IN (
  '09e3eba3-d5ff-41eb-a4a3-291248cda900',  -- large - spicy hot chicken pickle pizza (CORE)
  '7524568c-f47a-409c-9d03-b445462d8629',  -- md - fiery maple & squash (CORE)
  'dc231312-5e21-409c-8af0-879352512160',  -- md - garlic lover (CORE)
  '52b4ed9c-5085-4acc-8099-aeaed4ea9ce3',  -- md - keto pizza (CORE)
  '244acba4-e381-4731-8c98-43f6416d19f8',  -- pepperoni lover (CORE)
  '912dabc6-b6ce-4913-8373-7831813fe486',  -- half keto (MI)
  'bf2c92d2-f77a-49cc-b79a-a2cb0d6530a6',  -- large garlic lover (MI)
  '133ad38a-2c49-47bf-bfe5-47fed359058d'   -- fiery maple drizzle (PREP)
);
