-- Add face_titles column for per-face titles on 3D data cubes
ALTER TABLE public.user_dashboard_cubes
ADD COLUMN IF NOT EXISTS face_titles jsonb DEFAULT NULL;