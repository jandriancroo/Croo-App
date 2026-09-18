DO $$
DECLARE v_id uuid; v1 timestamptz; v2 timestamptz; v3 timestamptz;
BEGIN
  INSERT INTO public.brand_inventory_templates (brand_id, product_name, status)
  VALUES ('5f805404-cc7b-454b-a994-fe5901c32e6a', '__trigger_test__ delete me', 'draft')
  RETURNING id, archived_at INTO v_id, v1;
  RAISE NOTICE 'TEST insert as draft -> archived_at = % (expected NULL)', v1;

  UPDATE public.brand_inventory_templates SET status = 'archived' WHERE id = v_id
  RETURNING archived_at INTO v2;
  RAISE NOTICE 'TEST set archived -> archived_at = % (expected a timestamp)', v2;

  UPDATE public.brand_inventory_templates SET status = 'live' WHERE id = v_id
  RETURNING archived_at INTO v3;
  RAISE NOTICE 'TEST back to live -> archived_at = % (expected NULL)', v3;

  DELETE FROM public.brand_inventory_templates WHERE id = v_id;

  IF v1 IS NOT NULL OR v2 IS NULL OR v3 IS NOT NULL THEN
    RAISE EXCEPTION 'Trigger test FAILED: draft=%, archived=%, live=%', v1, v2, v3;
  END IF;
  RAISE NOTICE 'Trigger test PASSED; test row removed.';
END $$;