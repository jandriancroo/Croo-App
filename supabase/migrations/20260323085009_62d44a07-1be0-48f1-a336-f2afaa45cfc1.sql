-- Fix PA order delivery_date and order_date from raw_data where they're wrong
-- This corrects all orders where the scraper captured the real delivery_date
-- but the persist code overwrote it with nextDay(today)

UPDATE pa_orders
SET 
  delivery_date = (raw_data->>'deliveryDate')::date,
  order_date = ((raw_data->>'deliveryDate')::date - interval '1 day')::date
WHERE (raw_data->>'deliveryDate') IS NOT NULL
  AND delivery_date::text != (raw_data->>'deliveryDate');