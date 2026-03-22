
-- Deactivate legacy recipe duplicates that now exist as blueprints
DELETE FROM inventory_recipe_ingredients
WHERE recipe_item_id IN (
  '59f11054-5485-46be-af1d-776ecd29220c',
  '10b6ac28-1686-4e48-99e8-3bf8c1b60529',
  '416d7732-5485-4a52-a470-583d8c5482d2',
  '9b530ca1-a285-48fb-9c87-2295c59e9ced',
  '49bc5bc6-79a7-42a1-9ef7-c241f6084bd6',
  '79453f71-69ae-4170-a6d7-59ef527a21c4',
  'a2188c01-721b-45db-ad10-c4d31ed7fb71',
  '02e522b6-3278-47d1-8625-09ba314fbd57'
);

UPDATE inventory_items
SET is_active = false, is_recipe = false
WHERE id IN (
  '59f11054-5485-46be-af1d-776ecd29220c',
  '10b6ac28-1686-4e48-99e8-3bf8c1b60529',
  '416d7732-5485-4a52-a470-583d8c5482d2',
  '9b530ca1-a285-48fb-9c87-2295c59e9ced',
  '49bc5bc6-79a7-42a1-9ef7-c241f6084bd6',
  '79453f71-69ae-4170-a6d7-59ef527a21c4',
  'a2188c01-721b-45db-ad10-c4d31ed7fb71',
  '02e522b6-3278-47d1-8625-09ba314fbd57'
)
AND is_recipe = true AND is_active = true;
