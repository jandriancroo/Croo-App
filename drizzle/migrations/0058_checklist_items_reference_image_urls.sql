ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS reference_image_urls text[] NOT NULL DEFAULT '{}';

UPDATE public.checklist_items
SET reference_image_urls = ARRAY[reference_image_url]
WHERE coalesce(reference_image_url,'') <> '' AND reference_image_urls = '{}';

-- Keeps slot 1 of the list and the old single column in step for any writer.
CREATE OR REPLACE FUNCTION public.sync_checklist_item_reference_images()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.reference_image_urls := coalesce(array_remove(array_remove(NEW.reference_image_urls, NULL), ''), '{}');
  IF TG_OP = 'UPDATE'
     AND NEW.reference_image_url IS DISTINCT FROM OLD.reference_image_url
     AND NEW.reference_image_urls IS NOT DISTINCT FROM OLD.reference_image_urls THEN
    -- Old-style writer changed only the single column: update slot 1, keep 2+.
    IF coalesce(NEW.reference_image_url,'') = '' THEN
      NEW.reference_image_urls := coalesce(NEW.reference_image_urls[2:], '{}');
    ELSE
      NEW.reference_image_urls := ARRAY[NEW.reference_image_url] || coalesce(NEW.reference_image_urls[2:], '{}');
    END IF;
  ELSIF cardinality(NEW.reference_image_urls) = 0 AND coalesce(NEW.reference_image_url,'') <> '' THEN
    NEW.reference_image_urls := ARRAY[NEW.reference_image_url];
  END IF;
  NEW.reference_image_url := NEW.reference_image_urls[1];
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_checklist_item_reference_images ON public.checklist_items;
CREATE TRIGGER trg_sync_checklist_item_reference_images
BEFORE INSERT OR UPDATE ON public.checklist_items
FOR EACH ROW EXECUTE FUNCTION public.sync_checklist_item_reference_images();

CREATE OR REPLACE FUNCTION public.duplicate_checklist_as_draft(_source_id uuid, _activation_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    family_id, replaces_checklist_id, activation_at, superseded_at
  )
  VALUES (
    src.title, src.description, src.frequency, COALESCE(auth.uid(), src.created_by), false,
    src.due_by_time, src.template_type, src.assigned_day_of_week, src.display_order,
    src.visible_days_before_month_end, src.location_id, src.enable_am_pm_division,
    src.lock_until_time, src.position_filtering_enabled, src.requires_manager_approval,
    src.scheduled_date,
    v_family, src.id, _activation_at, NULL
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.checklist_items (
    checklist_id, question, item_type, options, order_index, is_required,
    reference_image_url, reference_image_urls, reference_link, reference_video_url, reference_notes,
    days_of_week, requires_temperature_validation, temperature_alert_enabled,
    manager_shift, position, link_refs
  )
  SELECT
    v_new_id, question, item_type, options, order_index, is_required,
    reference_image_url, reference_image_urls, reference_link, reference_video_url, reference_notes,
    days_of_week, requires_temperature_validation, temperature_alert_enabled,
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