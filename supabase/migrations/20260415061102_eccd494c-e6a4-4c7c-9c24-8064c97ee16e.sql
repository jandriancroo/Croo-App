
-- 1) DEACTIVATE 22 items marked "PLEASE DEACTIVE FOR ME"
UPDATE public.inventory_items SET is_active = false
WHERE location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6'
AND is_active = true
AND id IN (
  '8a963fb7-aaa9-43a8-8ab1-8dd4fb645cb0',
  '8fcd3d7b-0187-42ba-96b1-d9e9ea4a25fc',
  '67ab8f42-c70f-4b38-b6e4-726397723a14',
  '4922d796-0f6f-43d3-92bf-f94bb61ffb72',
  '598b3889-97ad-44eb-ab84-1d4feb0db2db',
  'bcced6c2-9272-4e0b-b0d4-16c42caf631e',
  'b2bc84c0-3cd4-49bb-99c4-b960417d6f7f',
  '957df00c-e94d-41d7-933e-f4b5819002b4',
  '0ed569a9-2f94-4b6e-8b4d-1479b3d8eabb',
  'c07af821-4500-47b2-8ff1-c86103bfd965',
  'a9604447-e441-4afe-9d1d-0eea6e690e85',
  '11b5ab55-8a04-4db4-8d76-2d34cc0ec168',
  '47e8a7ff-9b47-4df5-ae12-1c32b4c5c624',
  '505ad9a7-4760-4d9c-9590-d235f882646d',
  '31cc27c6-4c5e-4f1f-b8c2-21a10147f2d6',
  '37245dd0-9fac-4f74-b48c-5fa634e42825',
  '40fdb43d-18a4-4c1d-896d-c67f6f891332',
  '74451fdc-fef8-40d9-a477-b0e88a84d693',
  '27698994-2122-4014-b4fa-316516e4665d',
  'd528a4e1-2a7e-437d-8972-6fcaf2214c29',
  'c3163150-207c-4e45-a1f4-b638d825dbb3',
  'bfe53cc2-8091-4352-a839-9e19fda2008f'
);

-- 2) Assign to Bottled Drinks
UPDATE public.inventory_items SET storage_location_id = '1afd64d2-78c0-47cc-b26c-f73af8862f39'
WHERE id IN (
  '2b17c3df-682a-48fb-9703-73ddeb70e258',
  'cf65ecda-4e4b-428a-8614-c7facc135d01',
  'df9ae2fa-84f7-4e06-8636-019f519f27ff',
  'ade0e55b-821f-4181-8f2f-316d89ea4bc8',
  'da4eb101-6314-49dc-9994-119653ce086e'
);

-- 3) Assign to Chemicals
UPDATE public.inventory_items SET storage_location_id = '32992b09-9cb1-4c94-b9f0-f2cd5fc16f61'
WHERE id = '9ffc1fbf-5737-4470-a570-31da13004b2a';

-- 4) Assign to Janitorial Supplies
UPDATE public.inventory_items SET storage_location_id = '5d7ba693-d2c5-4a2c-bb3a-1c52db82d994'
WHERE id IN (
  'f48d48b1-7581-43d8-8a19-a06d94241eaa',
  'b41f81d8-0c55-4833-a8cc-f18f10cf7175'
);

-- 5) Assign to Drink Station
UPDATE public.inventory_items SET storage_location_id = 'f561cff1-d3ef-4847-b4f1-59f7992a54d3'
WHERE id IN (
  '2ec798d0-dbe7-4afd-8c62-a09da9e4cd0f',
  '49d02355-a483-47f4-ba31-caea5abd2f72'
);

-- 6) Assign to Food Items
UPDATE public.inventory_items SET storage_location_id = '7a847172-9592-48a7-bbad-67fbcae93f4c'
WHERE id IN (
  'b1d35326-36a6-42aa-a8b5-766e2415707a',
  '213fdb3f-c75d-4ccd-bd87-fa42dab32fb4',
  '8c51942b-4e01-4f78-b165-18d15b672237'
);

-- 7) Assign to Walk In
UPDATE public.inventory_items SET storage_location_id = 'bc3811b4-f6a8-435f-8997-304cd6d49ab9'
WHERE id IN (
  'e6f3115a-d59e-439b-9654-90bfb7e3d8c7',
  'ae787b18-aa8d-46a6-8ec2-61d9442251b9'
);
