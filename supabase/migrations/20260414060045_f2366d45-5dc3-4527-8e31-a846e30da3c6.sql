
-- ============================================================
-- TRANSFER TWIN COUNT ENTRIES TO SURVIVORS — Hemet Apr 12 count
-- count_id: 675df408-c24c-404d-8a08-cae67d4e04a6
-- ============================================================

-- Step 1: Delete survivors' empty placeholder entries (qty=0, no storage loc)
-- so re-pointed twin entries don't collide
DELETE FROM inventory_count_items WHERE id IN (
  '4d5b03a6-5a86-4a2d-b798-d454b99cb257',  -- Arugula survivor placeholder
  '2aa0c1c0-5c6e-4c79-85db-3464c7f2a6c0',  -- Green Bell Peppers survivor placeholder
  '25a2e20a-da3f-4a2a-a2ed-760ebe19dfa8',  -- Red Onions survivor placeholder
  '65210c11-2a06-4377-9cef-4267cbd67257',  -- Sliced Mushrooms survivor placeholder
  '8029c053-a7b0-4253-ae98-d8014b4188e4'   -- Chit Paper Rolls survivor placeholder
);

-- Step 2: Re-point twin count entries to survivor item_ids
-- Arugula: twin 0aaf45a7 → survivor f2b68e25
UPDATE inventory_count_items SET item_id = 'f2b68e25-fb13-479c-bb88-16bb29588f48'
WHERE count_id = '675df408-c24c-404d-8a08-cae67d4e04a6'
  AND item_id = '0aaf45a7-f5e2-433d-a64f-d7e893e2459d';

-- Green Bell Peppers: twin a4121989 → survivor 436d3e0a
UPDATE inventory_count_items SET item_id = '436d3e0a-daa6-4a8b-b6f6-af987cbad894'
WHERE count_id = '675df408-c24c-404d-8a08-cae67d4e04a6'
  AND item_id = 'a4121989-bdc2-4961-a019-ecbbd4be31fa';

-- Red Onions: twin bb6f9ccc → survivor c16cc85e
UPDATE inventory_count_items SET item_id = 'c16cc85e-c87f-4ece-b666-1a21d9039c52'
WHERE count_id = '675df408-c24c-404d-8a08-cae67d4e04a6'
  AND item_id = 'bb6f9ccc-c543-4608-b8e8-770002533246';

-- Sliced Mushrooms: twin ed73909b → survivor ae5e1f43
UPDATE inventory_count_items SET item_id = 'ae5e1f43-3128-47be-ad40-affea5354bb1'
WHERE count_id = '675df408-c24c-404d-8a08-cae67d4e04a6'
  AND item_id = 'ed73909b-e7d4-438e-9c88-9215a80dc7a2';

-- Chit Paper Rolls: twin f5b3ff72 → survivor 9a802879
UPDATE inventory_count_items SET item_id = '9a802879-09d2-439c-b7df-4407ca694748'
WHERE count_id = '675df408-c24c-404d-8a08-cae67d4e04a6'
  AND item_id = 'f5b3ff72-205b-4bad-975d-f866e0032bac';

-- Step 3: Drop Green Scrub Pads count entry (archived, no survivor)
DELETE FROM inventory_count_items
WHERE count_id = '675df408-c24c-404d-8a08-cae67d4e04a6'
  AND item_id = 'eccd428e-0c9f-4433-a482-8962194c4206';
