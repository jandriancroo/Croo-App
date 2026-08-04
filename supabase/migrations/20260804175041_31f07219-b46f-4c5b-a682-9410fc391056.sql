-- 1. Add the new role to the enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'shift_manager_in_training';

COMMIT;

-- 2. Rank it just below shift_manager for "highest role wins" resolution
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY
    CASE role
      WHEN 'super_admin' THEN 0
      WHEN 'brand_admin' THEN 1
      WHEN 'org_admin' THEN 2
      WHEN 'admin' THEN 3
      WHEN 'manager' THEN 4
      WHEN 'general_manager' THEN 4
      WHEN 'shift_manager' THEN 5
      WHEN 'shift_manager_in_training' THEN 6
      WHEN 'team_member' THEN 7
    END
  LIMIT 1
$function$;

-- 3. Treat it as shift_manager-equivalent for access checks (default = same permissions)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND (
        role = _role
        OR (role = 'super_admin'::app_role)
        OR (role = 'org_admin'::app_role AND _role IN ('admin'::app_role, 'general_manager'::app_role, 'shift_manager'::app_role, 'manager'::app_role, 'shift_manager_in_training'::app_role))
        OR (role = 'admin'::app_role AND _role IN ('general_manager'::app_role, 'shift_manager'::app_role, 'manager'::app_role, 'shift_manager_in_training'::app_role))
        OR (role = 'shift_manager'::app_role AND _role = 'shift_manager_in_training'::app_role)
        OR (role = 'shift_manager_in_training'::app_role AND _role = 'shift_manager'::app_role)
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_role_or_higher(_user_id uuid, _minimum_role text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role::text = ANY(
        CASE _minimum_role
          WHEN 'team_member' THEN ARRAY['team_member', 'shift_manager_in_training', 'shift_manager', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'shift_manager_in_training' THEN ARRAY['shift_manager_in_training', 'shift_manager', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'shift_manager' THEN ARRAY['shift_manager_in_training', 'shift_manager', 'manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'manager' THEN ARRAY['manager', 'general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'general_manager' THEN ARRAY['general_manager', 'admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'admin' THEN ARRAY['admin', 'org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'org_admin' THEN ARRAY['org_admin', 'fbc', 'brand_admin', 'super_admin']
          WHEN 'fbc' THEN ARRAY['fbc', 'brand_admin', 'super_admin']
          WHEN 'brand_admin' THEN ARRAY['brand_admin', 'super_admin']
          WHEN 'super_admin' THEN ARRAY['super_admin']
          ELSE ARRAY[]::text[]
        END
      )
  )
$function$;

-- 4. Seed configurable permissions + notification settings mirroring shift_manager
INSERT INTO public.role_permissions (role, permission_key, permission_label, enabled)
SELECT 'shift_manager_in_training'::app_role, rp.permission_key, rp.permission_label, rp.enabled
FROM public.role_permissions rp
WHERE rp.role = 'shift_manager'::app_role
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions x
    WHERE x.role = 'shift_manager_in_training'::app_role
      AND x.permission_key = rp.permission_key
  );

INSERT INTO public.role_notification_settings (role, notification_type, notification_label, enabled)
SELECT 'shift_manager_in_training'::app_role, rn.notification_type, rn.notification_label, rn.enabled
FROM public.role_notification_settings rn
WHERE rn.role = 'shift_manager'::app_role
  AND NOT EXISTS (
    SELECT 1 FROM public.role_notification_settings x
    WHERE x.role = 'shift_manager_in_training'::app_role
      AND x.notification_type = rn.notification_type
  );