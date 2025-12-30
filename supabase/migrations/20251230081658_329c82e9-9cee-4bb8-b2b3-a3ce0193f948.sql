-- Migrate general_manager to manager in user_roles
UPDATE public.user_roles 
SET role = 'manager'::app_role 
WHERE role = 'general_manager'::app_role;

-- Migrate fbc to admin (if any exist)
UPDATE public.user_roles 
SET role = 'admin'::app_role 
WHERE role = 'fbc'::app_role;