-- Create role_permissions table to store custom permissions for each role
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  permission_key text NOT NULL,
  permission_label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(role, permission_key)
);

-- Enable RLS
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Admins can manage role permissions
CREATE POLICY "Admins can manage role permissions"
ON public.role_permissions
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Everyone can view role permissions
CREATE POLICY "Everyone can view role permissions"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_role_permissions_updated_at
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Insert default permissions for each role
INSERT INTO public.role_permissions (role, permission_key, permission_label, enabled) VALUES
-- Admin permissions
('admin', 'full_system_access', 'Full system access', true),
('admin', 'manage_users_roles', 'Manage all users and roles', true),
('admin', 'manage_locations', 'Create and manage locations', true),
('admin', 'publish_schedules', 'Publish schedules', true),
('admin', 'manage_checklists', 'Manage checklists and templates', true),
('admin', 'view_reports', 'View all reports and analytics', true),
('admin', 'manage_certifications', 'Manage certifications', true),
('admin', 'access_payroll', 'Access payroll and labor data', true),

-- Manager permissions
('manager', 'edit_schedules', 'View and edit schedules', true),
('manager', 'manage_availability', 'Manage availability requests', true),
('manager', 'view_timecards', 'View team timecards', true),
('manager', 'create_tasks', 'Create and assign tasks', true),
('manager', 'view_labor_reports', 'View labor reports', true),
('manager', 'manage_shift_templates', 'Manage shift templates', true),

-- Team member permissions
('team_member', 'view_own_schedule', 'View own schedule', true),
('team_member', 'submit_availability', 'Submit availability requests', true),
('team_member', 'clock_in_out', 'Clock in/out', true),
('team_member', 'complete_checklists', 'Complete assigned checklists', true),
('team_member', 'view_own_timecard', 'View own timecard', true),
('team_member', 'shift_marketplace', 'Participate in shift marketplace', true)
ON CONFLICT (role, permission_key) DO NOTHING;