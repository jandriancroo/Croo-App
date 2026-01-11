
-- 1. Add changed_by column to schedule_change_log
ALTER TABLE public.schedule_change_log 
ADD COLUMN changed_by uuid REFERENCES auth.users(id);

-- 2. Create trigger function to log role changes to employee_notes
CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_role_name text;
  new_role_name text;
  changed_by_id uuid;
  changed_by_name text;
BEGIN
  -- Get role display names
  old_role_name := CASE OLD.role::text
    WHEN 'super_admin' THEN 'Super Admin'
    WHEN 'brand_admin' THEN 'Brand Admin'
    WHEN 'org_admin' THEN 'Org Admin'
    WHEN 'admin' THEN 'Admin'
    WHEN 'manager' THEN 'Manager'
    WHEN 'shift_manager' THEN 'Shift Manager'
    WHEN 'team_member' THEN 'Team Member'
    ELSE OLD.role::text
  END;
  
  new_role_name := CASE NEW.role::text
    WHEN 'super_admin' THEN 'Super Admin'
    WHEN 'brand_admin' THEN 'Brand Admin'
    WHEN 'org_admin' THEN 'Org Admin'
    WHEN 'admin' THEN 'Admin'
    WHEN 'manager' THEN 'Manager'
    WHEN 'shift_manager' THEN 'Shift Manager'
    WHEN 'team_member' THEN 'Team Member'
    ELSE NEW.role::text
  END;
  
  -- Only log if role actually changed
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    -- Get the current user (who made the change)
    changed_by_id := auth.uid();
    
    -- Get the name of the person who made the change
    IF changed_by_id IS NOT NULL THEN
      SELECT full_name INTO changed_by_name 
      FROM public.profiles 
      WHERE id = changed_by_id;
    END IF;
    
    -- Insert a note documenting the role change
    INSERT INTO public.employee_notes (user_id, note, created_by)
    VALUES (
      NEW.user_id,
      'Role changed from ' || old_role_name || ' to ' || new_role_name || 
      ' by ' || COALESCE(changed_by_name, 'System') ||
      ' on ' || to_char(NOW() AT TIME ZONE 'America/Los_Angeles', 'Mon DD, YYYY at HH12:MI AM'),
      COALESCE(changed_by_id, NEW.user_id) -- Use the employee's own ID if system change (for FK constraint)
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- 3. Create trigger on user_roles for role changes
CREATE TRIGGER trigger_log_role_change
AFTER UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.log_role_change();

-- 4. Add index for faster change log queries
CREATE INDEX idx_schedule_change_log_schedule_created 
ON public.schedule_change_log(schedule_id, created_at DESC);
