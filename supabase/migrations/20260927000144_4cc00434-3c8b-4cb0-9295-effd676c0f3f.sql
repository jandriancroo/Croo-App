-- ===== 0. Private backups (schema not exposed to the API) =====
CREATE SCHEMA IF NOT EXISTS backup;
REVOKE ALL ON SCHEMA backup FROM PUBLIC, anon, authenticated;

CREATE TABLE backup.role_permissions_20260926 AS SELECT * FROM public.role_permissions;
CREATE TABLE backup.role_notification_settings_20260926 AS SELECT * FROM public.role_notification_settings;
CREATE TABLE backup.policies_20260926 AS
  SELECT * FROM pg_policies
   WHERE (schemaname = 'public' AND tablename IN ('role_permissions','role_notification_settings','pay_periods'))
      OR (schemaname = 'storage' AND tablename = 'objects'
          AND (coalesce(qual,'') ILIKE '%vendor-invoices%' OR coalesce(with_check,'') ILIKE '%vendor-invoices%'));
CREATE TABLE backup.constraints_20260926 AS
  SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
   WHERE conrelid IN ('public.role_permissions'::regclass, 'public.role_notification_settings'::regclass);
CREATE TABLE backup.functiondefs_20260926 AS
  SELECT p.oid::regprocedure::text AS signature, pg_get_functiondef(p.oid) AS def, now() AS captured_at
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('labor_day_user_totals','labor_day_totals','get_store_labor',
                       'send_day_part_pulse','send_hourly_sales_pulse');
ALTER TABLE backup.role_permissions_20260926 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.role_notification_settings_20260926 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.policies_20260926 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.constraints_20260926 ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup.functiondefs_20260926 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA backup FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM backup.role_permissions_20260926) <> 53
     OR (SELECT count(*) FROM backup.role_notification_settings_20260926) <> 169
     OR (SELECT count(*) FROM public.organizations) <> 12
     OR (SELECT count(*) FROM backup.functiondefs_20260926) <> 5 THEN
    RAISE EXCEPTION 'D3 pre-check failed: unexpected starting counts';
  END IF;
END $$;

-- ===== 1. Templates (defaults for new orgs) =====
CREATE TABLE public.role_permissions_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  permission_key text NOT NULL,
  permission_label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, permission_key)
);
CREATE TABLE public.role_notification_settings_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  notification_type text NOT NULL,
  notification_label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, notification_type)
);
GRANT SELECT ON public.role_permissions_template, public.role_notification_settings_template TO authenticated;
GRANT ALL ON public.role_permissions_template, public.role_notification_settings_template TO service_role;
REVOKE ALL ON public.role_permissions_template, public.role_notification_settings_template FROM anon;
ALTER TABLE public.role_permissions_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_notification_settings_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can view role permission defaults" ON public.role_permissions_template
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins manage role permission defaults" ON public.role_permissions_template
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "Signed-in users can view role notification defaults" ON public.role_notification_settings_template
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Super admins manage role notification defaults" ON public.role_notification_settings_template
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE TRIGGER update_role_permissions_template_updated_at BEFORE UPDATE ON public.role_permissions_template
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_role_notification_settings_template_updated_at BEFORE UPDATE ON public.role_notification_settings_template
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.role_permissions_template (role, permission_key, permission_label, enabled, created_at, updated_at)
  SELECT role, permission_key, permission_label, enabled, created_at, updated_at FROM backup.role_permissions_20260926;
INSERT INTO public.role_notification_settings_template (role, notification_type, notification_label, enabled, created_at, updated_at)
  SELECT role, notification_type, notification_label, enabled, created_at, updated_at FROM backup.role_notification_settings_20260926;

-- ===== 2. Per-org copies =====
ALTER TABLE public.role_permissions ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.role_notification_settings ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.role_permissions DROP CONSTRAINT role_permissions_role_permission_key_key;
ALTER TABLE public.role_notification_settings DROP CONSTRAINT role_notification_settings_role_notification_type_key;

INSERT INTO public.role_permissions (organization_id, role, permission_key, permission_label, enabled, created_at, updated_at)
  SELECT o.id, b.role, b.permission_key, b.permission_label, b.enabled, b.created_at, b.updated_at
    FROM backup.role_permissions_20260926 b CROSS JOIN public.organizations o;
INSERT INTO public.role_notification_settings (organization_id, role, notification_type, notification_label, enabled, created_at, updated_at)
  SELECT o.id, b.role, b.notification_type, b.notification_label, b.enabled, b.created_at, b.updated_at
    FROM backup.role_notification_settings_20260926 b CROSS JOIN public.organizations o;

-- Originals are deleted after copying (kept in backup.* with original ids).
DELETE FROM public.role_permissions WHERE organization_id IS NULL;
DELETE FROM public.role_notification_settings WHERE organization_id IS NULL;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.role_permissions) <> 636 THEN
    RAISE EXCEPTION 'D3 abort: role_permissions count % <> 636', (SELECT count(*) FROM public.role_permissions);
  END IF;
  IF (SELECT count(*) FROM public.role_notification_settings) <> 2028 THEN
    RAISE EXCEPTION 'D3 abort: role_notification_settings count % <> 2028', (SELECT count(*) FROM public.role_notification_settings);
  END IF;
  IF EXISTS (
    SELECT o.id, b.role, b.permission_key, b.permission_label, b.enabled
      FROM backup.role_permissions_20260926 b CROSS JOIN public.organizations o
    EXCEPT
    SELECT organization_id, role, permission_key, permission_label, enabled FROM public.role_permissions
  ) OR EXISTS (
    SELECT o.id, b.role, b.notification_type, b.notification_label, b.enabled
      FROM backup.role_notification_settings_20260926 b CROSS JOIN public.organizations o
    EXCEPT
    SELECT organization_id, role, notification_type, notification_label, enabled FROM public.role_notification_settings
  ) THEN
    RAISE EXCEPTION 'D3 abort: per-org copies differ from snapshot';
  END IF;
END $$;

ALTER TABLE public.role_permissions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.role_notification_settings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_org_role_key_key UNIQUE (organization_id, role, permission_key);
ALTER TABLE public.role_notification_settings ADD CONSTRAINT role_notification_settings_org_role_type_key UNIQUE (organization_id, role, notification_type);

-- ===== 3. RLS on the live tables =====
DROP POLICY "Everyone can view role permissions" ON public.role_permissions;
DROP POLICY "Admins can manage role permissions" ON public.role_permissions;
DROP POLICY "Users can view role notification settings" ON public.role_notification_settings;
DROP POLICY "Admins can manage role notification settings" ON public.role_notification_settings;

REVOKE ALL ON public.role_permissions, public.role_notification_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions, public.role_notification_settings TO authenticated;
GRANT ALL ON public.role_permissions, public.role_notification_settings TO service_role;

CREATE POLICY "Org members view role permissions" ON public.role_permissions FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org admins insert role permissions" ON public.role_permissions FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
              OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)));
CREATE POLICY "Org admins update role permissions" ON public.role_permissions FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
         OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
              OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)));
CREATE POLICY "Org admins delete role permissions" ON public.role_permissions FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
         OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)));

CREATE POLICY "Org members view role notification settings" ON public.role_notification_settings FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org admins insert role notification settings" ON public.role_notification_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
              OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)));
CREATE POLICY "Org admins update role notification settings" ON public.role_notification_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
         OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
              OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)));
CREATE POLICY "Org admins delete role notification settings" ON public.role_notification_settings FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_org_admin(auth.uid(), organization_id)
         OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_org_member(auth.uid(), organization_id)));

-- ===== 4. Seeding new orgs =====
CREATE OR REPLACE FUNCTION public.seed_org_role_settings(_org uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  INSERT INTO public.role_permissions (organization_id, role, permission_key, permission_label, enabled)
    SELECT _org, t.role, t.permission_key, t.permission_label, t.enabled FROM public.role_permissions_template t
    ON CONFLICT (organization_id, role, permission_key) DO NOTHING;
  INSERT INTO public.role_notification_settings (organization_id, role, notification_type, notification_label, enabled)
    SELECT _org, t.role, t.notification_type, t.notification_label, t.enabled FROM public.role_notification_settings_template t
    ON CONFLICT (organization_id, role, notification_type) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.trg_seed_org_role_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.seed_org_role_settings(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER seed_org_role_settings_after_insert AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.trg_seed_org_role_settings();

-- ===== 5. Org-aware lookups (template fallback) =====
CREATE OR REPLACE FUNCTION public._org_role_permission_enabled(_location_id uuid, _role text, _key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT rp.enabled FROM public.role_permissions rp
       JOIN public.locations l ON l.organization_id = rp.organization_id
      WHERE l.id = _location_id AND rp.role::text = _role AND rp.permission_key = _key LIMIT 1),
    (SELECT t.enabled FROM public.role_permissions_template t
      WHERE t.role::text = _role AND t.permission_key = _key LIMIT 1),
    false)
$$;

CREATE OR REPLACE FUNCTION public._org_role_notification_settings(_location_id uuid)
RETURNS TABLE(role public.app_role, notification_type text, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH org AS (SELECT l.organization_id FROM public.locations l WHERE l.id = _location_id),
  o AS (
    SELECT s.role, s.notification_type, s.enabled FROM public.role_notification_settings s
     WHERE s.organization_id = (SELECT organization_id FROM org)
  )
  SELECT o.role, o.notification_type, o.enabled FROM o
  UNION ALL
  SELECT t.role, t.notification_type, t.enabled FROM public.role_notification_settings_template t
   WHERE NOT EXISTS (SELECT 1 FROM o WHERE o.role = t.role AND o.notification_type = t.notification_type)
$$;

REVOKE ALL ON FUNCTION public.seed_org_role_settings(uuid), public.trg_seed_org_role_settings(),
  public._org_role_permission_enabled(uuid,text,text), public._org_role_notification_settings(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_org_role_settings(uuid), public._org_role_permission_enabled(uuid,text,text),
  public._org_role_notification_settings(uuid) TO service_role;

-- ===== 6. Pulse functions read the location's org (text-patched from live definitions) =====
DO $$
DECLARE
  v_fn text;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['send_day_part_pulse','send_hourly_sales_pulse'] LOOP
    SELECT pg_get_functiondef(('public.' || v_fn || '()')::regprocedure) INTO v_def;
    v_new := replace(v_def, 'FROM role_notification_settings rns', 'FROM public._org_role_notification_settings(loc.id) rns');
    IF v_new = v_def THEN RAISE EXCEPTION 'pulse patch: lookup not found in %', v_fn; END IF;
    IF position(E'SET search_path TO ''public''\n' IN v_new) = 0 THEN
      RAISE EXCEPTION 'pulse patch: search_path line not found in %', v_fn;
    END IF;
    v_new := replace(v_new, E'SET search_path TO ''public''\n', E'SET search_path TO ''public'', ''pg_temp''\n');
    EXECUTE v_new;
  END LOOP;
END $$;

-- ===== 7. get_store_labor gates (D2 + D3.6 + R17) =====
CREATE OR REPLACE FUNCTION public.get_store_labor(_location_ids uuid[], _start date, _end date)
 RETURNS TABLE(location_id uuid, date date, source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_loc uuid;
  v_d date;
  v_mgr boolean;
  v_tm boolean;
  v_dev boolean;
  v_today date;
BEGIN
  IF _location_ids IS NULL OR _start IS NULL OR _end IS NULL OR _end < _start
     OR (_end - _start) > 92 OR cardinality(_location_ids) > 100 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;

  FOREACH v_loc IN ARRAY _location_ids LOOP
    CONTINUE WHEN v_loc IS NULL OR v_loc = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid;
    -- Store totals: shift manager and up with store or brand access.
    v_mgr := coalesce(v_uid IS NOT NULL
               AND public.has_role_or_higher(v_uid, 'shift_manager')
               AND (public.is_super_admin(v_uid)
                    OR public.has_location_access(v_uid, v_loc)
                    OR public.has_brand_access_via_location(v_uid, v_loc)), false);
    -- Team members: only when the LOCATION's org has "See Store Sales Data" on (template fallback).
    v_tm := NOT v_mgr AND coalesce(v_uid IS NOT NULL
               AND public.has_role_or_higher(v_uid, 'team_member')
               AND public.has_location_access(v_uid, v_loc)
               AND public._org_role_permission_enabled(v_loc, 'team_member', 'view_sales'), false);
    -- Paired device: own store, business today only (unchanged).
    v_dev := coalesce(v_uid IS NOT NULL AND public.punch_device_location(v_uid) = v_loc, false);
    IF NOT v_mgr AND NOT v_tm AND NOT v_dev THEN
      RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
    END IF;
    v_today := public.business_date(v_loc);

    FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
      CONTINUE WHEN NOT (v_mgr OR v_tm) AND v_d <> v_today;  -- paired device: business today only
      RETURN QUERY
        SELECT v_loc, v_d, s.source, s.hours, s.cost, s.net_sales, s.labor_pct, s.is_live, s.as_of
          FROM public._store_labor(v_loc, v_d, v_d = v_today) s;
    END LOOP;
  END LOOP;
END;
$function$;