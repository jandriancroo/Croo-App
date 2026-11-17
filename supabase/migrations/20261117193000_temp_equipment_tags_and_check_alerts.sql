-- Temp-reader ship 2 (Jordan, Nov 17 2026).
-- 1. One equipment tag per temp task (checklist_items.equipment_type). Nullable:
--    untagged keeps today's broad check. NO production items are tagged here.
--    Bands live in supabase/functions/_shared/tempBands.ts (server + app).
-- 2. temperature_read_issues: log readings thrown out as outside the unit's
--    possible range (implausible) and hot borderline retake prompts.
-- 3. duplicate_checklist_as_draft copies the tag to new versions.
-- 4. Equipment-check alert: same unit (same checklist family + task name at
--    the store) saves out-of-compliance readings on 2 separate store-local
--    days within 2 days -> one equipment_check_alerts row per episode, plus
--    ONE alert_queue push/email to manager-and-up with access to that store
--    (recipients picked here, server side). The badge is readable only by
--    manager-and-up with store access (RLS); everyone else sees nothing new.
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_equipment_check_on_temp ON public.checklist_responses;
--   DROP FUNCTION IF EXISTS public._equipment_check_on_temp();
--   DROP FUNCTION IF EXISTS public.acknowledge_equipment_check(uuid);
--   DROP TABLE IF EXISTS public.equipment_check_alerts;
--   ALTER TABLE public.checklist_items DROP COLUMN IF EXISTS equipment_type;
--   (re-run 20261116233000 for the old reason list after deleting new-reason rows;
--    restore duplicate_checklist_as_draft without equipment_type.)

-- 1 ---------------------------------------------------------------------------
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS equipment_type text;
ALTER TABLE public.checklist_items DROP CONSTRAINT IF EXISTS checklist_items_equipment_type_check;
ALTER TABLE public.checklist_items ADD CONSTRAINT checklist_items_equipment_type_check
  CHECK (equipment_type IS NULL OR equipment_type IN ('freezer','refrigerator','walk_in','line','hot_holding','reheating'));

-- 2 ---------------------------------------------------------------------------
ALTER TABLE public.temperature_read_issues DROP CONSTRAINT IF EXISTS temperature_read_issues_reason_check;
ALTER TABLE public.temperature_read_issues ADD CONSTRAINT temperature_read_issues_reason_check
  CHECK (reason IN ('read_failed','reads_disagree','one_read_failed','function_error','unclear','tiebreak_confirmed','implausible','borderline_retake'));

-- 3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.duplicate_checklist_as_draft(_source_id uuid, _activation_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src public.checklists;
  v_family uuid;
  v_new_id uuid;
  v_existing_draft uuid;
BEGIN
  SELECT * INTO src FROM public.checklists WHERE id = _source_id;
  IF src.id IS NULL THEN
    RAISE EXCEPTION 'Checklist not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'org_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to duplicate this checklist';
  END IF;

  v_family := COALESCE(src.family_id, src.id);
  IF src.family_id IS NULL THEN
    UPDATE public.checklists SET family_id = v_family WHERE id = src.id;
  END IF;

  SELECT id INTO v_existing_draft
  FROM public.checklists
  WHERE family_id = v_family
    AND id <> src.id
    AND is_active = false
    AND superseded_at IS NULL
    AND replaces_checklist_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_draft IS NOT NULL THEN
    DELETE FROM public.checklists WHERE id = v_existing_draft;
  END IF;

  INSERT INTO public.checklists (
    title, description, frequency, created_by, is_active, due_by_time, template_type,
    assigned_day_of_week, display_order, visible_days_before_month_end, location_id,
    enable_am_pm_division, lock_until_time, position_filtering_enabled,
    requires_manager_approval, scheduled_date,
    schedule_repeats, schedule_period, schedule_mode, schedule_weekdays, schedule_day, schedule_quarter_month, schedule_last_n,
    family_id, replaces_checklist_id, activation_at, superseded_at
  )
  VALUES (
    src.title, src.description, src.frequency, COALESCE(auth.uid(), src.created_by), false,
    src.due_by_time, src.template_type, src.assigned_day_of_week, src.display_order,
    src.visible_days_before_month_end, src.location_id, src.enable_am_pm_division,
    src.lock_until_time, src.position_filtering_enabled, src.requires_manager_approval,
    src.scheduled_date,
    src.schedule_repeats, src.schedule_period, src.schedule_mode, src.schedule_weekdays, src.schedule_day, src.schedule_quarter_month, src.schedule_last_n,
    v_family, src.id, _activation_at, NULL
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.checklist_items (
    checklist_id, question, item_type, options, order_index, is_required,
    reference_image_url, reference_image_urls, reference_link, reference_video_url, reference_notes,
    days_of_week, requires_temperature_validation, temperature_alert_enabled, equipment_type,
    manager_shift, position, link_refs
  )
  SELECT
    v_new_id, question, item_type, options, order_index, is_required,
    reference_image_url, reference_image_urls, reference_link, reference_video_url, reference_notes,
    days_of_week, requires_temperature_validation, temperature_alert_enabled, equipment_type,
    manager_shift, position, link_refs
  FROM public.checklist_items
  WHERE checklist_id = src.id
    AND deleted_at IS NULL;

  INSERT INTO public.checklist_role_tags (checklist_id, role)
  SELECT v_new_id, role FROM public.checklist_role_tags WHERE checklist_id = src.id;

  INSERT INTO public.checklist_user_tags (checklist_id, user_id)
  SELECT v_new_id, user_id FROM public.checklist_user_tags WHERE checklist_id = src.id;

  RETURN v_new_id;
END;
$function$;

-- 4 ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment_check_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.checklist_items(id) ON DELETE SET NULL,
  unit_key text NOT NULL,
  unit_name text NOT NULL,
  location_name text NOT NULL,
  equipment_type text,
  timezone text,
  readings jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_failed_day date NOT NULL,
  last_failed_day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_by_name text,
  acknowledged_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_equipment_check_alerts_unit ON public.equipment_check_alerts (unit_key, last_failed_day DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_check_alerts_loc ON public.equipment_check_alerts (location_id, created_at DESC);

ALTER TABLE public.equipment_check_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.equipment_check_alerts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.equipment_check_alerts FROM authenticated;
GRANT SELECT ON public.equipment_check_alerts TO authenticated;
GRANT ALL ON public.equipment_check_alerts TO service_role;
DROP POLICY IF EXISTS "Managers with store access read equipment checks" ON public.equipment_check_alerts;
-- Badge is for manager-and-up with access to the store only (same rule as email + push).
CREATE POLICY "Managers with store access read equipment checks" ON public.equipment_check_alerts
  FOR SELECT TO authenticated
  USING (public._is_shift_manager_plus(auth.uid()) AND public.has_location_access(auth.uid(), location_id));

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment_check_alerts;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL; END $$;

-- Acknowledge from the badge. Manager-and-up with store access only; first tap wins.
CREATE OR REPLACE FUNCTION public.acknowledge_equipment_check(_alert_id uuid)
 RETURNS public.equipment_check_alerts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.equipment_check_alerts;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_row FROM public.equipment_check_alerts WHERE id = _alert_id;
  IF v_row.id IS NULL OR v_uid IS NULL
     OR NOT public._is_shift_manager_plus(v_uid)
     OR NOT public.has_location_access(v_uid, v_row.location_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF v_row.acknowledged_at IS NULL THEN
    UPDATE public.equipment_check_alerts
       SET acknowledged_by = v_uid,
           acknowledged_by_name = (SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid),
           acknowledged_at = now()
     WHERE id = _alert_id
     RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.acknowledge_equipment_check(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_equipment_check(uuid) TO authenticated, service_role;

-- The alert check. Runs as a trigger after a temp reading is saved or fixed.
CREATE OR REPLACE FUNCTION public._equipment_check_on_temp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_item record;
  v_loc uuid;
  v_loc_name text;
  v_tz text;
  v_day date;
  v_key text;
  v_days int;
  v_readings jsonb;
  v_latest numeric;
  v_alert_id uuid;
  v_recipients uuid[];
BEGIN
  IF NEW.temperature_valid IS DISTINCT FROM false OR NEW.extracted_temperature IS NULL THEN
    RETURN NEW;
  END IF;
  -- Never block saving a reading because the alert check hit a problem.
  BEGIN

  SELECT ci.id, ci.question, ci.equipment_type, COALESCE(c.family_id, c.id) AS family_id, c.location_id AS cl_location
    INTO v_item
    FROM public.checklist_items ci
    JOIN public.checklists c ON c.id = ci.checklist_id
   WHERE ci.id = NEW.item_id;
  -- Only tagged units alert (untagged tasks keep today's behaviour).
  IF v_item.id IS NULL OR v_item.equipment_type IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(cs.location_id, v_item.cl_location) INTO v_loc
    FROM public.checklist_submissions cs WHERE cs.id = NEW.submission_id;
  v_loc := COALESCE(v_loc, v_item.cl_location);
  IF v_loc IS NULL THEN RETURN NEW; END IF;

  SELECT l.name, COALESCE((SELECT ls.timezone FROM public.location_settings ls WHERE ls.location_id = l.id LIMIT 1), 'America/Los_Angeles')
    INTO v_loc_name, v_tz
    FROM public.locations l WHERE l.id = v_loc;

  v_day := (COALESCE(NEW.temperature_validated_at, NEW.created_at, now()) AT TIME ZONE v_tz)::date;
  -- Same unit across checklist versions: store + checklist family + task name.
  v_key := v_loc::text || ':' || v_item.family_id::text || ':' || lower(btrim(v_item.question));

  PERFORM pg_advisory_xact_lock(hashtextextended('equipment_check:' || v_key, 0));

  -- Failed saved readings for this unit on the store-local days (v_day - 1 .. v_day):
  -- latest failed reading per day.
  WITH fails AS (
    SELECT cr.extracted_temperature AS temp,
           COALESCE(cr.temperature_validated_at, cr.created_at) AS at,
           (COALESCE(cr.temperature_validated_at, cr.created_at) AT TIME ZONE v_tz)::date AS d
      FROM public.checklist_responses cr
      JOIN public.checklist_items ci2 ON ci2.id = cr.item_id
      JOIN public.checklists c2 ON c2.id = ci2.checklist_id
      LEFT JOIN public.checklist_submissions cs2 ON cs2.id = cr.submission_id
     WHERE COALESCE(c2.family_id, c2.id) = v_item.family_id
       AND lower(btrim(ci2.question)) = lower(btrim(v_item.question))
       AND COALESCE(cs2.location_id, c2.location_id) = v_loc
       AND cr.temperature_valid = false
       AND cr.extracted_temperature IS NOT NULL
       AND COALESCE(cr.temperature_validated_at, cr.created_at) >= now() - interval '4 days'
  ), per_day AS (
    SELECT DISTINCT ON (d) d, temp, at FROM fails
     WHERE d BETWEEN v_day - 1 AND v_day
     ORDER BY d, at DESC
  )
  SELECT count(*), COALESCE(jsonb_agg(jsonb_build_object('temp', trim_scale(temp), 'at', at) ORDER BY at), '[]'::jsonb),
         (array_agg(temp ORDER BY at DESC))[1]
    INTO v_days, v_readings, v_latest
    FROM per_day;

  IF v_days < 2 THEN RETURN NEW; END IF;

  -- One alert per unit per episode: a still-running streak just extends it.
  UPDATE public.equipment_check_alerts
     SET last_failed_day = GREATEST(last_failed_day, v_day)
   WHERE unit_key = v_key AND last_failed_day >= v_day - 1;
  IF FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.equipment_check_alerts (location_id, item_id, unit_key, unit_name, location_name, equipment_type, timezone, readings, first_failed_day, last_failed_day)
  VALUES (v_loc, v_item.id, v_key, btrim(v_item.question), COALESCE(v_loc_name, ''), v_item.equipment_type, v_tz, v_readings, v_day - 1, v_day)
  RETURNING id INTO v_alert_id;

  -- Email + push go to manager-and-up with access to this store only (picked here).
  SELECT array_agg(DISTINCT ur.user_id) INTO v_recipients
    FROM public.user_locations ul
    JOIN public.user_roles ur ON ur.user_id = ul.user_id
    JOIN public.profiles p ON p.id = ul.user_id
   WHERE ul.location_id = v_loc
     AND ur.role IN ('manager','general_manager','admin','org_admin','brand_admin','super_admin')
     AND COALESCE(p.is_active, true)
     AND public.has_location_access(ur.user_id, v_loc);

  IF COALESCE(array_length(v_recipients, 1), 0) > 0 THEN
    INSERT INTO public.alert_queue (alert_type, dedup_key, location_id, payload)
    VALUES ('equipment_check', 'equipment_check_' || v_alert_id::text, v_loc,
      jsonb_build_object(
        'user_ids', to_jsonb(v_recipients),
        'title', 'Please check equipment',
        -- Keep in step with _shared/equipmentCheck.ts pushBody.
        'body', btrim(v_item.question) || ' at ' || COALESCE(v_loc_name, 'your store') || ' failed temp checks 2 days in a row (' || trim_scale(v_latest)::text || '°F).',
        'notification_type', 'equipment_check',
        'data', jsonb_build_object('type', 'equipment_check', 'equipment_alert_id', v_alert_id, 'location_id', v_loc, 'url', '/dashboard')))
    ON CONFLICT (dedup_key) DO NOTHING;
  END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'equipment check skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._equipment_check_on_temp() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_equipment_check_on_temp ON public.checklist_responses;
CREATE TRIGGER trg_equipment_check_on_temp
  AFTER INSERT OR UPDATE OF extracted_temperature, temperature_valid ON public.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION public._equipment_check_on_temp();
