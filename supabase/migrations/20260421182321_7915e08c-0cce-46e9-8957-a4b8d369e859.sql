CREATE TABLE inventory_items_produce_backup_20260421 AS
SELECT * FROM inventory_items
WHERE location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6'
  AND name IN ('Arugula','Grape Tomatoes','Green Bell Peppers',
    'Red Onions','Sliced Mushrooms','Spring Mix',
    'Squash, Zucchini, Diced');