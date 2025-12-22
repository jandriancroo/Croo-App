-- Add pizza estimation settings to location_settings
ALTER TABLE public.location_settings 
ADD COLUMN IF NOT EXISTS pizza_sales_percentage numeric DEFAULT 80,
ADD COLUMN IF NOT EXISTS average_pizza_price numeric DEFAULT 10.50;

-- Add comment for documentation
COMMENT ON COLUMN public.location_settings.pizza_sales_percentage IS 'Percentage of total sales that are pizzas (0-100)';
COMMENT ON COLUMN public.location_settings.average_pizza_price IS 'Average price per pizza for estimation calculations';