-- Add team member sales view setting to location_settings
-- Default is FALSE - team members cannot see sales by default
ALTER TABLE public.location_settings
ADD COLUMN IF NOT EXISTS team_member_sales_view_enabled boolean NOT NULL DEFAULT false;