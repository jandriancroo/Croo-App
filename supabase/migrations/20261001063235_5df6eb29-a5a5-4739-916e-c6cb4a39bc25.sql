DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.clone_count_to_sandbox(uuid,uuid)'::regprocedure);
  d := replace(d,
$a$    CASE
      WHEN i.brand_item_id IS NOT NULL AND bt.status = 'live' THEN true
      ELSE i.is_active
    END AS is_active,$a$,
$b$    CASE
      WHEN i.is_active THEN true
      WHEN i.brand_item_id IS NOT NULL AND bt.status = 'live'
           AND NOT EXISTS (SELECT 1 FROM public.inventory_items s2
                           WHERE s2.location_id = i.location_id AND s2.brand_item_id = i.brand_item_id
                             AND (s2.is_active OR (s2.id < i.id)))
        THEN true
      ELSE false
    END AS is_active,$b$);
  IF position('s2.brand_item_id' in d) = 0 THEN RAISE EXCEPTION 'replace failed'; END IF;
  EXECUTE d;
END $mig$;