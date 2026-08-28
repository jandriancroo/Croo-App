-- ============ 1. Version tracking columns ============
ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS family_id uuid,
  ADD COLUMN IF NOT EXISTS replaces_checklist_id uuid REFERENCES public.checklists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_checklists_family_id ON public.checklists(family_id);
CREATE INDEX IF NOT EXISTS idx_checklists_activation_at ON public.checklists(activation_at) WHERE activation_at IS NOT NULL;

-- Backfill: every existing checklist is its own family head.
UPDATE public.checklists SET family_id = id WHERE family_id IS NULL;

-- ============ 2. Duplicate in place (draft) ============
CREATE OR REPLACE FUNCTION public.duplicate_checklist_as_draft(
  _source_id uuid,
  _activation_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Family id is stamped once and never changed.
  v_family := COALESCE(src.family_id, src.id);
  IF src.family_id IS NULL THEN
    UPDATE public.checklists SET family_id = v_family WHERE id = src.id;
  END IF;

  -- Only one pending draft per family: replace it.
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
    reference_image_url, reference_link, reference_video_url, reference_notes,
    days_of_week, requires_temperature_validation, temperature_alert_enabled,
    manager_shift, position, link_refs
  )
  SELECT
    v_new_id, question, item_type, options, order_index, is_required,
    reference_image_url, reference_link, reference_video_url, reference_notes,
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
$$;

-- ============ 3. The swap (single transaction) ============
CREATE OR REPLACE FUNCTION public.perform_checklist_swap(_draft_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  draft public.checklists;
  src public.checklists;
BEGIN
  SELECT * INTO draft FROM public.checklists WHERE id = _draft_id FOR UPDATE;
  IF draft.id IS NULL OR draft.replaces_checklist_id IS NULL THEN
    RETURN false;
  END IF;
  IF draft.is_active = true OR draft.superseded_at IS NOT NULL THEN
    RETURN false; -- already swapped
  END IF;

  SELECT * INTO src FROM public.checklists WHERE id = draft.replaces_checklist_id FOR UPDATE;
  IF src.id IS NULL THEN
    RETURN false;
  END IF;

  -- Seasonal kill switch: source was manually turned off, not superseded. Do not resurrect.
  IF src.is_active = false AND src.superseded_at IS NULL THEN
    UPDATE public.checklists SET activation_at = NULL WHERE id = draft.id;
    RETURN false;
  END IF;

  UPDATE public.checklists
  SET is_active = false, superseded_at = now()
  WHERE id = src.id;

  UPDATE public.checklists
  SET is_active = true, activation_at = NULL
  WHERE id = draft.id;

  RETURN true;
END;
$$;

-- ============ 4. Scheduled runner ============
CREATE OR REPLACE FUNCTION public.run_due_checklist_swaps()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
  n INTEGER := 0;
BEGIN
  FOR d IN
    SELECT id FROM public.checklists
    WHERE activation_at IS NOT NULL
      AND activation_at <= now()
      AND is_active = false
      AND superseded_at IS NULL
      AND replaces_checklist_id IS NOT NULL
    ORDER BY activation_at
  LOOP
    IF public.perform_checklist_swap(d.id) THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.run_due_checklist_swaps() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_checklist_as_draft(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perform_checklist_swap(uuid) TO authenticated;

-- Runs at :02 past each hour so it always lands BEFORE the 11:05 UTC digest queue.
SELECT cron.schedule('run-checklist-swaps', '2 * * * *', 'SELECT public.run_due_checklist_swaps();');