
-- ============================================================
-- Helper functions (SECURITY DEFINER, read punch_clock_devices)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_punch_device(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.punch_clock_devices
    WHERE auth_user_id = _user_id AND revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.punch_device_location(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT location_id FROM public.punch_clock_devices
  WHERE auth_user_id = _user_id AND revoked_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_punch_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.punch_device_location(uuid) TO authenticated;

-- ============================================================
-- Direct location_id policies (InitPlan-wrapped)
-- ============================================================
CREATE POLICY "Punch device can read sales_cache at its location"
ON public.sales_cache FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read labor_cache at its location"
ON public.labor_cache FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read location_settings at its location"
ON public.location_settings FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read time_punches at its location"
ON public.time_punches FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read schedule_events at its location"
ON public.schedule_events FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read checklists at its location"
ON public.checklists FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read checklist_submissions at its location"
ON public.checklist_submissions FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read temporary_tasks at its location"
ON public.temporary_tasks FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

CREATE POLICY "Punch device can read punch_clock_templates at its location"
ON public.punch_clock_templates FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND location_id = (SELECT public.punch_device_location(auth.uid()))
);

-- ============================================================
-- Joined location policies
-- ============================================================
CREATE POLICY "Punch device can read scheduled_shifts at its location"
ON public.scheduled_shifts FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = scheduled_shifts.schedule_id
      AND s.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);

CREATE POLICY "Punch device can read temporary_task_subtasks at its location"
ON public.temporary_task_subtasks FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    WHERE tt.id = temporary_task_subtasks.task_id
      AND tt.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);

CREATE POLICY "Punch device can read task_subtask_completions at its location"
ON public.task_subtask_completions FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    WHERE tt.id = task_subtask_completions.task_id
      AND tt.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);

CREATE POLICY "Punch device can read event_task_completions at its location"
ON public.event_task_completions FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.schedule_events se
    WHERE se.id = event_task_completions.event_id
      AND se.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);

CREATE POLICY "Punch device can read alarm_task_completions at its location"
ON public.alarm_task_completions FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.temporary_tasks tt
    WHERE tt.id = alarm_task_completions.task_id
      AND tt.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);

-- ============================================================
-- Profiles — only staff assigned to the device's location
-- ============================================================
CREATE POLICY "Punch device can read profiles at its location"
ON public.profiles FOR SELECT TO authenticated
USING (
  (SELECT public.is_punch_device(auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = profiles.id
      AND ul.location_id = (SELECT public.punch_device_location(auth.uid()))
  )
);
