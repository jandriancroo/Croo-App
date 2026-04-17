-- Standardize vendor_source for PA: merge 'pa' rows into 'produce_alliance'
-- Step 1: For each ('pa', item_number) row that has a matching ('produce_alliance', item_number) row
-- in the same brand, union their reported_by_locations into the produce_alliance row.
DO $$
DECLARE
  r RECORD;
  merged_locs jsonb;
BEGIN
  FOR r IN
    SELECT a.id AS pa_id, a.reported_by_locations AS pa_locs,
           b.id AS canonical_id, b.reported_by_locations AS canonical_locs
    FROM vendor_gap_alerts a
    JOIN vendor_gap_alerts b
      ON a.brand_id = b.brand_id
     AND a.item_number = b.item_number
     AND a.vendor_source = 'pa'
     AND b.vendor_source = 'produce_alliance'
  LOOP
    -- Union locations by id (dedupe)
    SELECT COALESCE(jsonb_agg(DISTINCT loc), '[]'::jsonb)
    INTO merged_locs
    FROM (
      SELECT jsonb_array_elements(COALESCE(r.canonical_locs, '[]'::jsonb)) AS loc
      UNION
      SELECT jsonb_array_elements(COALESCE(r.pa_locs, '[]'::jsonb)) AS loc
    ) u;

    UPDATE vendor_gap_alerts
    SET reported_by_locations = merged_locs
    WHERE id = r.canonical_id;

    DELETE FROM vendor_gap_alerts WHERE id = r.pa_id;
  END LOOP;
END $$;

-- Step 2: Any remaining 'pa' rows have no canonical twin — just rename them.
UPDATE vendor_gap_alerts
SET vendor_source = 'produce_alliance'
WHERE vendor_source = 'pa';