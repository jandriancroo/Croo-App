-- Add notification settings for general_manager and shift_manager roles
INSERT INTO public.role_notification_settings (role, notification_type, notification_label, enabled)
SELECT 'general_manager', notification_type, notification_label, enabled 
FROM public.role_notification_settings 
WHERE role = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_notification_settings (role, notification_type, notification_label, enabled)
SELECT 'shift_manager', notification_type, notification_label, enabled 
FROM public.role_notification_settings 
WHERE role = 'manager'
ON CONFLICT DO NOTHING;

-- Add permission settings for general_manager and shift_manager roles
INSERT INTO public.role_permissions (role, permission_key, permission_label, enabled)
SELECT 'general_manager', permission_key, permission_label, enabled 
FROM public.role_permissions 
WHERE role = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key, permission_label, enabled)
SELECT 'shift_manager', permission_key, permission_label, enabled 
FROM public.role_permissions 
WHERE role = 'manager'
ON CONFLICT DO NOTHING;