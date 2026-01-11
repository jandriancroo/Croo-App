-- Add vendor column to catering_orders table
ALTER TABLE public.catering_orders 
ADD COLUMN vendor text DEFAULT 'ez_cater';