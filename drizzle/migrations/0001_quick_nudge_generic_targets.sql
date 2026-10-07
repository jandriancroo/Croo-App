ALTER TYPE public.visual_alert_type ADD VALUE IF NOT EXISTS 'quick_nudge';

CREATE TABLE public.nudge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  organization_id uuid,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('checklist','task','event')),
  target_id uuid NOT NULL,
  target_family_id uuid NOT NULL,
  target_title text NOT NULL,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  template_id uuid,
  message_raw text NOT NULL,
  message_sent text NOT NULL,
  source text NOT NULL CHECK (source IN ('dashboard','theo_chat','theo_voice')),
  business_date date NOT NULL,
  push_status text NOT NULL DEFAULT 'pending' CHECK (push_status IN ('pending','sent','no_device','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.nudge_log (id, batch_id, organization_id, location_id, target_type, target_id, target_family_id, target_title, sender_id, recipient_id, template_id, message_raw, message_sent, source, business_date, push_status, created_at)
  SELECT id, batch_id, organization_id, location_id, 'checklist', checklist_id, checklist_family_id, checklist_title, sender_id, recipient_id, template_id, message_raw, message_sent, source, business_date, push_status, created_at
  FROM public.checklist_nudge_log;
CREATE INDEX idx_nudge_log_cooldown ON public.nudge_log (target_type, target_family_id, recipient_id, created_at DESC);
CREATE INDEX idx_nudge_log2_location ON public.nudge_log (location_id, created_at DESC);
CREATE INDEX idx_nudge_log2_sender ON public.nudge_log (sender_id, created_at DESC);
REVOKE ALL ON public.nudge_log FROM anon, authenticated;
GRANT SELECT ON public.nudge_log TO authenticated;
GRANT ALL ON public.nudge_log TO service_role;
ALTER TABLE public.nudge_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Nudge log readable by sender, recipient or store managers" ON public.nudge_log
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid()
    OR (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id)));
COMMENT ON TABLE public.checklist_nudge_log IS 'DEPRECATED: replaced by nudge_log (target_type + target_id)';

DROP FUNCTION IF EXISTS public.record_checklist_nudges(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, date, int);

CREATE OR REPLACE FUNCTION public.record_nudges(
  _batch uuid, _sender uuid, _location uuid, _org uuid, _target_type text, _target_id uuid, _family uuid, _title text,
  _template_id uuid, _message_raw text, _recipients jsonb, _source text, _business_date date, _cooldown_min int DEFAULT 60)
RETURNS TABLE(recipient_id uuid, status text, log_id uuid, last_sent_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE r jsonb; rid uuid; last_at timestamptz; new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_target_type || ':' || _family::text, 0));
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_recipients, '[]'::jsonb)) LOOP
    rid := (r->>'id')::uuid;
    SELECT max(l.created_at) INTO last_at FROM public.nudge_log l
      WHERE l.target_type = _target_type AND l.target_family_id = _family AND l.recipient_id = rid
        AND l.created_at > now() - make_interval(mins => _cooldown_min);
    IF last_at IS NOT NULL THEN
      recipient_id := rid; status := 'cooldown'; log_id := NULL; last_sent_at := last_at; RETURN NEXT;
    ELSE
      INSERT INTO public.nudge_log (batch_id, organization_id, location_id, target_type, target_id, target_family_id, target_title,
        sender_id, recipient_id, template_id, message_raw, message_sent, source, business_date)
      VALUES (_batch, _org, _location, _target_type, _target_id, _family, _title, _sender, rid, _template_id, _message_raw, r->>'message_sent', _source, _business_date)
      RETURNING id INTO new_id;
      recipient_id := rid; status := 'queued'; log_id := new_id; last_sent_at := now(); RETURN NEXT;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.record_nudges(uuid, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, jsonb, text, date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_nudges(uuid, uuid, uuid, uuid, text, uuid, uuid, text, uuid, text, jsonb, text, date, int) TO service_role;

CREATE OR REPLACE FUNCTION public.task_nudge_status(_location_id uuid, _task_id uuid DEFAULT NULL)
RETURNS TABLE(task_id uuid, title text, task_style text, is_active boolean, show_on_dashboard boolean, completed_at timestamptz,
  expires_at timestamptz, last_triggered_at timestamptz, alarm_done_this_interval boolean, write_up_id uuid, icon_name text,
  subtasks_total int, subtasks_done int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE tz text;
BEGIN
  SELECT COALESCE((SELECT ls.timezone FROM public.location_settings ls WHERE ls.location_id = _location_id LIMIT 1), 'America/Los_Angeles') INTO tz;
  RETURN QUERY
  SELECT t.id, t.title, t.task_style, t.is_active, t.show_on_dashboard, t.completed_at, t.expires_at, t.last_triggered_at,
    (t.last_triggered_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.alarm_task_completions a WHERE a.task_id = t.id
        AND a.interval_key = to_char(t.last_triggered_at AT TIME ZONE tz, 'YYYY-MM-DD') || '_' || to_char(t.last_triggered_at AT TIME ZONE tz, 'HH24MI'))),
    t.write_up_id, t.icon_name,
    (SELECT count(*)::int FROM public.temporary_task_subtasks s WHERE s.task_id = t.id),
    (SELECT count(*)::int FROM public.temporary_task_subtasks s WHERE s.task_id = t.id AND s.completed_at IS NOT NULL)
  FROM public.temporary_tasks t
  WHERE t.location_id = _location_id AND (_task_id IS NULL OR t.id = _task_id);
END $$;
REVOKE ALL ON FUNCTION public.task_nudge_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.task_nudge_status(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.event_nudge_status(_location_id uuid, _event_id uuid DEFAULT NULL)
RETURNS TABLE(event_id uuid, title text, event_time time, event_end_time time, tagged_roles jsonb, is_today boolean, completed_today boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE tz text; local_now timestamp; dow int; today date;
BEGIN
  SELECT COALESCE((SELECT ls.timezone FROM public.location_settings ls WHERE ls.location_id = _location_id LIMIT 1), 'America/Los_Angeles') INTO tz;
  local_now := now() AT TIME ZONE tz;
  today := local_now::date;
  dow := (EXTRACT(DOW FROM local_now)::int + 6) % 7; -- Monday = 0
  RETURN QUERY
  SELECT e.id, e.event_name, e.event_time, e.event_end_time, e.tagged_roles,
    (CASE WHEN e.days_of_week IS NOT NULL AND array_length(e.days_of_week, 1) > 0 THEN dow = ANY(e.days_of_week) ELSE e.day_of_week = dow END),
    EXISTS (SELECT 1 FROM public.event_task_completions c WHERE c.event_id = e.id AND c.completed_date = today)
  FROM public.schedule_events e
  WHERE e.location_id = _location_id AND e.is_daily_task AND e.is_recurring AND (_event_id IS NULL OR e.id = _event_id);
END $$;
REVOKE ALL ON FUNCTION public.event_nudge_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_nudge_status(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_location_nudge_templates(_location_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.location_nudge_templates WHERE location_id = _location_id) THEN RETURN; END IF;
  INSERT INTO public.location_nudge_templates (location_id, name, body, is_default, sort_order) VALUES
    (_location_id, 'Friendly follow-up', 'Hey, it''s {sender_first_name}. I noticed the {item} isn''t done yet and wanted to follow up. Can you make sure it gets finished?', true, 0),
    (_location_id, 'Quick check-in', 'Hey {recipient_first_name}, {sender_first_name} here. The {item} is at {done}/{total}. Can you jump on the rest when you get a sec?', false, 1),
    (_location_id, 'Before close', 'It''s {sender_first_name}. The {item} needs to be finished soon. Please wrap it up and let me know if anything''s blocking you.', false, 2),
    (_location_id, 'Heads-up', 'Heads-up from {sender_first_name}: {item} is at {event_time} today. Please be ready for it.', false, 3);
END $$;
REVOKE ALL ON FUNCTION public.seed_location_nudge_templates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_location_nudge_templates(uuid) TO service_role;
