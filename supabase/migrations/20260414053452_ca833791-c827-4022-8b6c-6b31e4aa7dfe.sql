
-- ============================================================
-- MERGE DUPLICATE INVENTORY ITEMS AT HEMET
-- For each pair: keep brand-deployed item, deactivate twin
-- ============================================================

-- 1. Arugula — survivor: f2b68e25 (deployed, pa:580), twin: 0aaf45a7 (pa:16901, $15.35)
-- Keep survivor's existing pa_item_id (580), update cost from twin
UPDATE inventory_items SET cost_per_unit = 15.35, pa_item_id = '16901' WHERE id = 'f2b68e25-fb13-479c-bb88-16bb29588f48';
UPDATE inventory_items SET is_active = false WHERE id = '0aaf45a7-f5e2-433d-a64f-d7e893e2459d';

-- 2. Fresh Basil — survivor: b7fefaf5 (deployed, pa:10320), twin: ae12a85c (pa:822, $8.02)
-- Both same price, keep survivor, deactivate twin
UPDATE inventory_items SET is_active = false WHERE id = 'ae12a85c-49c7-4702-8abc-3dc5065f6d78';

-- 3. Sliced Mushrooms — survivor: ae5e1f43 (deployed, pa:1488), twin: ed73909b (pa:21031, $29.25)
UPDATE inventory_items SET cost_per_unit = 29.25, pa_item_id = '21031' WHERE id = 'ae5e1f43-3128-47be-ad40-affea5354bb1';
UPDATE inventory_items SET is_active = false WHERE id = 'ed73909b-e7d4-438e-9c88-9215a80dc7a2';

-- 4. Green Bell Peppers — survivor: 436d3e0a (deployed, pa:1148), twin: a4121989 (pa:12802, $28.68)
UPDATE inventory_items SET cost_per_unit = 28.68, pa_item_id = '12802' WHERE id = '436d3e0a-daa6-4a8b-b6f6-af987cbad894';
UPDATE inventory_items SET is_active = false WHERE id = 'a4121989-bdc2-4961-a019-ecbbd4be31fa';

-- 5. Red Onions — survivor: c16cc85e (deployed, pa:4905), twin: bb6f9ccc (pa:14364, $13.95)
UPDATE inventory_items SET cost_per_unit = 13.95, pa_item_id = '14364' WHERE id = 'c16cc85e-c87f-4ece-b666-1a21d9039c52';
UPDATE inventory_items SET is_active = false WHERE id = 'bb6f9ccc-c543-4608-b8e8-770002533246';

-- 6. Spring Mix — survivor: 03a264a5 (deployed, pa:2227), twin: 4c7b2021 (pa:38923, $11.51)
UPDATE inventory_items SET cost_per_unit = 11.51, pa_item_id = '38923' WHERE id = '03a264a5-40ed-4112-8543-8bf30c6fed28';
UPDATE inventory_items SET is_active = false WHERE id = '4c7b2021-c364-4783-bf0c-8262ff897181';

-- 7. Romaine Lettuce — deployed item is d0d0c74b (inactive, pa:2633)
-- Reactivate it, set California PA ID (13380) and cost ($5.72)
UPDATE inventory_items SET is_active = true, pa_item_id = '13380', cost_per_unit = 5.72 WHERE id = 'd0d0c74b-8b55-4f67-a8c5-be76740324fa';
-- Deactivate both orphan twins
UPDATE inventory_items SET is_active = false WHERE id = '44be3972-e94d-4c22-87ba-a71c66537923';
UPDATE inventory_items SET is_active = false WHERE id = 'a1dd4512-ff0f-4e1b-b377-346beea70118';

-- 8. Crushed Red Pepper Bulk — survivor: b3877b1c (deployed), twin: cacbc7db
UPDATE inventory_items SET is_active = false WHERE id = 'cacbc7db-baaf-4abd-9b4c-ef39775ff764';

-- 9. Toilet Seat Covers — survivor: 3f36b3f8 (deployed), twin: 3358db1f
UPDATE inventory_items SET is_active = false WHERE id = '3358db1f-4e4b-4051-b0b5-c96229fee9e3';

-- 10. Chit Paper — survivor: 9a802879 (deployed), twin: f5b3ff72
UPDATE inventory_items SET is_active = false WHERE id = 'f5b3ff72-205b-4bad-975d-f866e0032bac';
