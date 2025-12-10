-- Add customizable safe and drawer bank amounts to location_settings
ALTER TABLE public.location_settings 
ADD COLUMN safe_target numeric NOT NULL DEFAULT 300,
ADD COLUMN drawer_bank numeric NOT NULL DEFAULT 200;

-- Add comment for clarity
COMMENT ON COLUMN public.location_settings.safe_target IS 'Target amount for safe count balance';
COMMENT ON COLUMN public.location_settings.drawer_bank IS 'Starting drawer bank amount to keep after deposit';