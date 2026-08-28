DO $do$
DECLARE
  d text := pg_get_functiondef('public.check_alerts_sql()'::regprocedure);
  n integer := 0;
BEGIN
  IF position('ci.deleted_at IS NULL' in d) > 0 THEN
    RAISE NOTICE 'check_alerts_sql already archive-aware, skipping';
    RETURN;
  END IF;

  IF position('WHERE ci.checklist_id = cl.id' in d) = 0
     OR position('WHERE ci.checklist_id = mcl.id' in d) = 0
     OR position('AND ci2.order_index <= ci.order_index' in d) = 0 THEN
    RAISE EXCEPTION 'check_alerts_sql shape changed — aborting archive-aware patch';
  END IF;

  d := replace(d, 'WHERE ci.checklist_id = cl.id',
                  'WHERE ci.checklist_id = cl.id AND ci.deleted_at IS NULL');
  d := replace(d, 'WHERE ci.checklist_id = mcl.id',
                  'WHERE ci.checklist_id = mcl.id AND ci.deleted_at IS NULL');
  d := replace(d, 'AND ci2.order_index <= ci.order_index',
                  'AND ci2.order_index <= ci.order_index AND ci2.deleted_at IS NULL');

  EXECUTE d;
END
$do$;