
-- Fix PA order 5983263: portal shows delivery 03/10, not 03/07
-- Order date was 03/05, delivery is next Tuesday 03/10
UPDATE pa_orders SET order_date = '2026-03-05', delivery_date = '2026-03-10'
WHERE pa_order_id = '5983263' AND location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6';

-- Remove PA order 5968348: status is SAVED (not submitted) on the portal, should not be counted
DELETE FROM pa_orders
WHERE pa_order_id = '5968348' AND location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6';
