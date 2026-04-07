
-- Deactivate the Unassigned (storage_location_id IS NULL) duplicates
-- keeping the shelf-assigned versions
UPDATE public.inventory_items SET is_active = false, updated_at = now()
WHERE id IN (
  'f2b68e25-fb13-479c-bb88-16bb29588f48',   -- Arugula (unassigned)
  '59b55014-d2b8-4fb8-8d24-eb107809acee',   -- Baby Spinach (unassigned)
  '9a802879-09d2-439c-b7df-4407ca694748',   -- Chit Paper Rolls (unassigned)
  'fdcd6fa8-c7f8-408c-8255-261b147d70d2',   -- Fresh Basil (unassigned)
  'b6f39823-52d4-402d-b862-218795e06058',   -- Grape Tomatoes (unassigned)
  '436d3e0a-daa6-4a8b-b6f6-af987cbad894',   -- Green Bell Peppers (unassigned)
  'c135f2e0-e5d6-44cd-94ea-0554cec0bb1d',   -- Pineapple Tidbits PA (unassigned)
  'c96a29f8-dd64-46e8-823f-6e36161e17da',   -- Red Onions (unassigned)
  '4869def3-be1f-474a-a54b-3b4538485d34',   -- Roasted Broccoli (unassigned)
  '44be3972-e94d-4c22-87ba-a71c66537923',   -- Romaine Lettuce (unassigned)
  'ae5e1f43-3128-47be-ad40-affea5354bb1',   -- Sliced Mushrooms (unassigned)
  '03a264a5-40ed-4112-8543-8bf30c6fed28'    -- Spring Mix (unassigned)
);
