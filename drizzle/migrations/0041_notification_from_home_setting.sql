ALTER TABLE public.role_notification_settings ADD COLUMN IF NOT EXISTS from_home boolean NOT NULL DEFAULT true;
ALTER TABLE public.role_notification_settings_template ADD COLUMN IF NOT EXISTS from_home boolean NOT NULL DEFAULT true;
ALTER TABLE public.user_notification_settings ADD COLUMN IF NOT EXISTS from_home boolean;
COMMENT ON COLUMN public.role_notification_settings.from_home IS 'Role default: deliver push while NOT clocked in at the alert store. Enforced in send-push-notification via _shared/notificationGate.ts.';
COMMENT ON COLUMN public.user_notification_settings.from_home IS 'Personal From home choice; NULL = use the role default.';

-- Floor roles: store-status alerts only while clocked in, unless the person turns From home on.
UPDATE public.role_notification_settings SET from_home = false
 WHERE role::text IN ('team_member','shift_manager','shift_manager_in_training')
   AND notification_type IN ('day_part_pulse','hourly_sales_pulse','overdue_checklists','late_arrivals','shift_overstay','toast_no_clock_out','toast_robot_down','vendor_sku_health','alarm_task');
UPDATE public.role_notification_settings_template SET from_home = false
 WHERE role::text IN ('team_member','shift_manager','shift_manager_in_training')
   AND notification_type IN ('day_part_pulse','hourly_sales_pulse','overdue_checklists','late_arrivals','shift_overstay','toast_no_clock_out','toast_robot_down','vendor_sku_health','alarm_task');

CREATE OR REPLACE FUNCTION public.seed_org_role_settings(_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  INSERT INTO public.role_permissions (organization_id, role, permission_key, permission_label, enabled)
    SELECT _org, t.role, t.permission_key, t.permission_label, t.enabled FROM public.role_permissions_template t
    ON CONFLICT (organization_id, role, permission_key) DO NOTHING;
  INSERT INTO public.role_notification_settings (organization_id, role, notification_type, notification_label, enabled, from_home)
    SELECT _org, t.role, t.notification_type, t.notification_label, t.enabled, t.from_home FROM public.role_notification_settings_template t
    ON CONFLICT (organization_id, role, notification_type) DO NOTHING;
END $function$;