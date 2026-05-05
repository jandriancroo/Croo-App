DROP FUNCTION IF EXISTS public.publish_tracker_to_locations(jsonb, uuid[]);
DROP FUNCTION IF EXISTS public.update_tracker_across_locations(text, jsonb, uuid[]);
DROP TABLE IF EXISTS public.user_dashboard_cubes CASCADE;
DROP TABLE IF EXISTS public.role_dashboard_cubes CASCADE;