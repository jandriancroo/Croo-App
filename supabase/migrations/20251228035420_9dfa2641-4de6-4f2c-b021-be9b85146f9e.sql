-- Add widget_size column to user_dashboard_cubes table
-- small = 1x1 square, medium = 2x1 wide, large = 2x2 full
ALTER TABLE public.user_dashboard_cubes 
ADD COLUMN IF NOT EXISTS widget_size text NOT NULL DEFAULT 'small' 
CHECK (widget_size IN ('small', 'medium', 'large'));