
UPDATE inventory_items SET is_active = false
WHERE id IN (
  'bbfa78e7-8c92-48fd-9561-73cd41b7a2c3',  -- BROOM LOBBY 9"
  '5c3baf3e-2b65-4f8e-8015-00f1fb81bdfa',  -- COVER TOILET SEAT
  'abda113e-e5e7-41f2-a746-fb5b6ac05419'   -- RESTOCK FEE
);
