-- Fix PA orders incorrectly bound to wrong periods
-- These orders delivered Mar 23-24 should NOT be bound to WE Mar 8 or WE Mar 15
UPDATE pa_orders
SET bound_to_count_id = NULL
WHERE location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6'
  AND pa_order_id IN ('5983263', '5968350', '5996505', '6012368')
  AND delivery_date >= '2026-03-23';