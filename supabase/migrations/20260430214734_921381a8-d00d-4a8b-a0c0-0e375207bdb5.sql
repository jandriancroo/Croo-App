BEGIN;
UPDATE inventory_items SET pack_quantity_override = 1000 WHERE id IN ('f07795d3-36b4-457c-b546-ffbe4651e9c2','dd7bbe9f-ba06-4fcd-a13a-fb92f2684c91');

UPDATE inventory_count_items ici
SET pack_quantity_at_count = 1000
FROM inventory_counts ic
WHERE ici.count_id = ic.id
  AND ic.location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6'
  AND ic.status = 'completed'
  AND ici.item_id IN ('f07795d3-36b4-457c-b546-ffbe4651e9c2','dd7bbe9f-ba06-4fcd-a13a-fb92f2684c91');
COMMIT;