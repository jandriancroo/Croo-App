
-- Shift Hemet Apr 12 count to FLEX (Apr 13) since it was counted after the period ended
UPDATE inventory_counts
SET period_end_date = '2026-04-13'
WHERE id = '675df408-c24c-404d-8a08-cae67d4e04a6';
