-- Add show_wallet and show_sick_time_balance settings to location_settings
ALTER TABLE public.location_settings 
ADD COLUMN IF NOT EXISTS show_wallet boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS show_sick_time_balance boolean NOT NULL DEFAULT true;

-- Add comments
COMMENT ON COLUMN public.location_settings.show_wallet IS 'Controls visibility of Wallet feature for users at this location';
COMMENT ON COLUMN public.location_settings.show_sick_time_balance IS 'Controls visibility of Sick Time balance on Availability screen for users at this location';