-- Create function to assign user to location during signup (bypasses RLS)
CREATE OR REPLACE FUNCTION public.assign_user_to_location(
  p_user_id uuid,
  p_location_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Insert user location assignment
  INSERT INTO public.user_locations (user_id, location_id)
  VALUES (p_user_id, p_location_id)
  ON CONFLICT (user_id, location_id) DO NOTHING;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.assign_user_to_location(uuid, uuid) TO authenticated;