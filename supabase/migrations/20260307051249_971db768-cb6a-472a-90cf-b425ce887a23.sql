-- Fix existing PA orders: derive delivery_date as order_date + 1 day based on the summary's orderDate
-- For the specific wrong order (5983263), the portal said March 10 but it was ordered Thu March 6 → delivers Fri March 7
-- We need to fix order_date and delivery_date for this record

-- Fix the specific March 10 order — it was ordered March 6 (Thursday), delivers March 7 (Friday)
UPDATE pa_orders 
SET order_date = '2026-03-06', delivery_date = '2026-03-07'
WHERE pa_order_id = '5983263' AND location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6';

-- Also fix any other PA orders where order_date = delivery_date (they should be +1 day apart)
-- For older orders that already have correct order_date (different from delivery_date), leave them alone
UPDATE pa_orders 
SET delivery_date = (order_date::date + interval '1 day')::date
WHERE order_date = delivery_date 
  AND pa_order_id NOT LIKE 'manual_%';