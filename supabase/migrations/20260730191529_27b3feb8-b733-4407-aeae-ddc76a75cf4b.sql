-- 1. Pin search_path on the 5 functions missing it
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.generate_pairing_code() SET search_path = public;

-- 2. Email queue internals: service_role only
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.enqueue_email(text, jsonb)',
    'public.delete_email(text, bigint)',
    'public.read_email_batch(text, integer, integer)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.email_queue_dispatch()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 3. Internal cron / maintenance routines: service_role only
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.check_alerts_sql()',
    'public.cleanup_internal_logs()',
    'public.cleanup_theo_chat_messages()',
    'public.trigger_alarm_tasks_sql()',
    'public.queue_nightly_emails()',
    'public.queue_nightly_maintenance()',
    'public.send_day_part_pulse()',
    'public.send_hourly_sales_pulse()',
    'public.send_shift_overstay_alerts()',
    'public.prune_alert_queue(integer)',
    'public.prune_checklist_notification_logs(integer)',
    'public.prune_email_queue(integer)',
    'public.prune_inventory_count_audit_log(integer)',
    'public.prune_pfg_refresh_audit(integer)',
    'public.prune_punch_clock_attempts(integer)',
    'public.prune_visual_alert_queue()',
    'public.refresh_all_pfg_tokens()',
    'public.pfg_swap_credentials(uuid, text, jsonb)',
    'public.pfg_swap_credentials_ropc(uuid, jsonb)',
    'public.generate_unique_pin()',
    'public.generate_pairing_code()',
    'public.increment_croo_cash(uuid, integer)',
    'public.assign_user_to_location(uuid, uuid)',
    'public.clone_count_into_sandbox(uuid, uuid, uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 4. Revoke anon EXECUTE from every remaining SECURITY DEFINER non-trigger function,
--    except the kiosk PIN lookup and the boolean/helper predicates that RLS policies
--    themselves evaluate as the calling role.
DO $$
DECLARE r record;
  keep text[] := ARRAY[
    'punch_clock_lookup_pin',
    'has_role','has_role_or_higher','has_location_access','has_brand_access',
    'has_brand_access_via_location','has_active_location_integration',
    'is_super_admin','is_brand_admin','is_brand_or_super_admin','is_org_admin',
    'is_org_member','is_org_active','is_chat_member','is_punch_device',
    'can_see_admin_locations','can_manage_org_applications','can_manage_rejection_templates',
    'get_user_location_ids','get_user_role','punch_device_location',
    'profile_at_punch_device_location','user_qualifies_for_channel_audience'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef
      AND pg_get_function_result(p.oid) <> 'trigger'
      AND NOT (p.proname = ANY(keep))
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.oid NOT IN (SELECT d.objid FROM pg_depend d WHERE d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;