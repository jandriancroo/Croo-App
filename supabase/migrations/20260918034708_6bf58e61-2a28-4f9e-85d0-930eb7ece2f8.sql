DO $$
DECLARE
  v_loc uuid := '12c977c7-1786-4131-90f5-1eef3f96e2c6';
  v_before_total int; v_before_active int; v_before_hidden int;
  v_hidden int; v_links int; v_deleted int;
  v_after_total int; v_after_active int; v_after_hidden int;
  v_active_r365 int; v_orphans int; v_sessions int; v_lines int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE user_hidden)
    INTO v_before_total, v_before_active, v_before_hidden
  FROM public.inventory_items WHERE location_id = v_loc;

  RAISE NOTICE 'BEFORE: total=% active=% hidden=%', v_before_total, v_before_active, v_before_hidden;

  -- Step 1: hide inactive r365 rows that carry count history
  WITH upd AS (
    UPDATE public.inventory_items ii
       SET user_hidden = true,
           deactivated_reason = 'R365 import cleanup — retained for count history',
           updated_at = now()
     WHERE ii.location_id = v_loc
       AND ii.source = 'r365_import'
       AND ii.is_active = false
       AND EXISTS (SELECT 1 FROM public.inventory_count_items ci WHERE ci.item_id = ii.id)
    RETURNING 1
  ) SELECT count(*) INTO v_hidden FROM upd;
  RAISE NOTICE 'Step 1 hidden rows: %', v_hidden;

  -- Zero-count-history target set
  CREATE TEMP TABLE _doomed ON COMMIT DROP AS
  SELECT ii.id
    FROM public.inventory_items ii
   WHERE ii.location_id = v_loc
     AND ii.source = 'r365_import'
     AND ii.is_active = false
     AND NOT EXISTS (SELECT 1 FROM public.inventory_count_items ci WHERE ci.item_id = ii.id);

  -- Step 2: remove recipe ingredient links (both roles)
  WITH del AS (
    DELETE FROM public.inventory_recipe_ingredients x
     WHERE x.recipe_item_id IN (SELECT id FROM _doomed)
        OR x.ingredient_item_id IN (SELECT id FROM _doomed)
    RETURNING 1
  ) SELECT count(*) INTO v_links FROM del;
  RAISE NOTICE 'Step 2 recipe-ingredient links deleted: %', v_links;

  -- Step 3: delete the zero-history items (guarded against active rows)
  WITH del2 AS (
    DELETE FROM public.inventory_items ii
     WHERE ii.id IN (SELECT id FROM _doomed)
       AND ii.is_active = false
    RETURNING 1
  ) SELECT count(*) INTO v_deleted FROM del2;
  RAISE NOTICE 'Step 3 items deleted: %', v_deleted;

  SELECT count(*), count(*) FILTER (WHERE is_active), count(*) FILTER (WHERE user_hidden)
    INTO v_after_total, v_after_active, v_after_hidden
  FROM public.inventory_items WHERE location_id = v_loc;

  SELECT count(*) INTO v_active_r365 FROM public.inventory_items
   WHERE location_id = v_loc AND source = 'r365_import' AND is_active = true;

  SELECT count(*) INTO v_orphans FROM public.inventory_count_items ci
   WHERE NOT EXISTS (SELECT 1 FROM public.inventory_items ii WHERE ii.id = ci.item_id);

  SELECT count(DISTINCT ci.count_id), count(*) INTO v_sessions, v_lines
    FROM public.inventory_count_items ci
    JOIN public.inventory_items ii ON ii.id = ci.item_id
   WHERE ii.location_id = v_loc;

  RAISE NOTICE 'AFTER: total=% active=% hidden=% active_r365=% orphan_count_rows=% sessions=% lines=%',
    v_after_total, v_after_active, v_after_hidden, v_active_r365, v_orphans, v_sessions, v_lines;

  IF v_after_active <> v_before_active THEN
    RAISE EXCEPTION 'Active row count changed (% -> %) — aborting', v_before_active, v_after_active;
  END IF;
  IF v_active_r365 <> 9 THEN
    RAISE EXCEPTION 'Expected 9 active r365 items, found % — aborting', v_active_r365;
  END IF;
END $$;