-- Add face_metrics column to store metrics organized by face for 3D cubes
-- Each face can have up to 3 metrics, and a cube can have 1-4 faces
-- Format: [["metric1", "metric2", "metric3"], ["metric4", "metric5"], ...]
ALTER TABLE public.user_dashboard_cubes
ADD COLUMN face_metrics jsonb DEFAULT '[]'::jsonb;

-- Add num_faces column to track how many faces the cube uses (1-4)
ALTER TABLE public.user_dashboard_cubes
ADD COLUMN num_faces integer DEFAULT 1 CHECK (num_faces >= 1 AND num_faces <= 4);

-- Add comment for documentation
COMMENT ON COLUMN public.user_dashboard_cubes.face_metrics IS 'Metrics organized by face for 3D cubes. Array of arrays, each inner array contains up to 3 metric keys for that face.';
COMMENT ON COLUMN public.user_dashboard_cubes.num_faces IS 'Number of faces to display on 3D cube (1-4). Single face means no rotation.';