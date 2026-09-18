DO $$
DECLARE v_loc uuid := '12c977c7-1786-4131-90f5-1eef3f96e2c6';
        v_bt int; v_ba int; v_bh int; v_hid int; v_at int; v_aa int; v_ah int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE user_hidden)
    INTO v_bt, v_ba, v_bh FROM public.inventory_items WHERE location_id = v_loc;
  RAISE NOTICE 'BEFORE: total=% active=% hidden=%', v_bt, v_ba, v_bh;

  WITH upd AS (
    UPDATE public.inventory_items ii
       SET is_active = false,
           user_hidden = true,
           deactivated_reason = 'Pre-redeploy cleanup — not linked to a live brand template',
           updated_at = now()
     WHERE ii.location_id = v_loc
       AND NOT (
         ii.brand_item_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.brand_inventory_templates t
                      WHERE t.id = ii.brand_item_id AND t.status = 'live')
       )
    RETURNING 1
  ) SELECT count(*) INTO v_hid FROM upd;
  RAISE NOTICE 'Hidden rows: %', v_hid;

  SELECT count(*), count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE user_hidden)
    INTO v_at, v_aa, v_ah FROM public.inventory_items WHERE location_id = v_loc;
  RAISE NOTICE 'AFTER: total=% active=% hidden=%', v_at, v_aa, v_ah;
END $$;