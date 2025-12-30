-- Add labor percentage target column to location_settings
ALTER TABLE public.location_settings 
ADD COLUMN labor_percentage_target numeric DEFAULT 25;

-- Add comment explaining the column
COMMENT ON COLUMN public.location_settings.labor_percentage_target IS 'Target labor cost as percentage of sales (default 25%)';