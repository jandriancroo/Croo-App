INSERT INTO logbook_fields (category_id, field_name, field_type, is_required, display_order)
SELECT lc.id, 'Details', 'text', false, 1
FROM logbook_categories lc
WHERE lower(lc.name) = 'waste log'
AND NOT EXISTS (
  SELECT 1 FROM logbook_fields lf 
  WHERE lf.category_id = lc.id AND lf.field_name = 'Details'
);