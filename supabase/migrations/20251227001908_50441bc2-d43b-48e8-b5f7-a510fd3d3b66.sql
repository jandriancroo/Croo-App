-- Add projected_sales column to hourly coverage table
ALTER TABLE public.week_template_hourly_coverage 
ADD COLUMN projected_sales NUMERIC(10,2) DEFAULT 0;