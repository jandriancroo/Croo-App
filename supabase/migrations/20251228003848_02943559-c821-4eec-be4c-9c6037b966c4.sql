-- Add cube_type column to support different cube types (data, checklist, task)
ALTER TABLE public.user_dashboard_cubes
ADD COLUMN cube_type text NOT NULL DEFAULT 'data';

-- Add reference_id for linking to specific checklists or tasks
ALTER TABLE public.user_dashboard_cubes
ADD COLUMN reference_id uuid NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.user_dashboard_cubes.cube_type IS 'Type of cube: data (metrics), checklist, or task';
COMMENT ON COLUMN public.user_dashboard_cubes.reference_id IS 'Reference to specific checklist or temporary task ID';