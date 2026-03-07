-- Revert the incorrect bulk update for orders 5968350 and 5968348
-- These were delivered March 6 (portal was correct), my earlier migration wrongly set them to March 7
-- Order 5968350: ordered Wed March 4 or 5, delivered Thu/Fri March 5 or 6 — portal said March 6, that's correct
-- Order 5968348: same situation
UPDATE pa_orders SET order_date = '2026-03-05', delivery_date = '2026-03-06'
WHERE pa_order_id IN ('5968350', '5968348') AND location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6';

-- Order 5983263: ordered Thu March 6 → delivers Fri March 7 (this one is correct as-is)
-- Just verify order_date is right
UPDATE pa_orders SET order_date = '2026-03-06', delivery_date = '2026-03-07'
WHERE pa_order_id = '5983263' AND location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6';