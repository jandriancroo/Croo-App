ALTER TYPE public.visual_alert_type ADD VALUE IF NOT EXISTS 'checklist_nudge';

CREATE TABLE public.checklist_nudge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  organization_id uuid,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  checklist_id uuid NOT NULL,
  checklist_family_id uuid NOT NULL,
  checklist_title text NOT NULL,
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
CREATE INDEX idx_nudge_log_family_recipient ON public.checklist_nudge_log (checklist_family_id, recipient_id, created_at DESC);
CREATE INDEX idx_nudge_log_location ON public.checklist_nudge_log (location_id, created_at DESC);
CREATE INDEX idx_nudge_log_sender ON public.checklist_nudge_log (sender_id, created_at DESC);
REVOKE ALL ON public.checklist_nudge_log FROM anon, authenticated;
GRANT SELECT ON public.checklist_nudge_log TO authenticated;
GRANT ALL ON public.checklist_nudge_log TO service_role;
ALTER TABLE public.checklist_nudge_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Nudge log readable by sender, recipient or store managers" ON public.checklist_nudge_log
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid()
    OR (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id)));

CREATE TABLE public.location_nudge_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 300),
  is_default boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nudge_templates_location ON public.location_nudge_templates (location_id, sort_order);
CREATE UNIQUE INDEX uq_nudge_templates_default ON public.location_nudge_templates (location_id) WHERE is_default;
REVOKE ALL ON public.location_nudge_templates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_nudge_templates TO authenticated;
GRANT ALL ON public.location_nudge_templates TO service_role;
ALTER TABLE public.location_nudge_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Nudge templates readable at accessible stores" ON public.location_nudge_templates
  FOR SELECT TO authenticated USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Managers add nudge templates" ON public.location_nudge_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Managers edit nudge templates" ON public.location_nudge_templates
  FOR UPDATE TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Managers delete nudge templates" ON public.location_nudge_templates
  FOR DELETE TO authenticated
  USING (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), location_id));

CREATE OR REPLACE FUNCTION public.nudge_templates_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
      RAISE EXCEPTION 'A nudge template cannot move to another store';
    END IF;
  ELSE
    IF (SELECT count(*) FROM public.location_nudge_templates WHERE location_id = NEW.location_id) >= 5 THEN
      RAISE EXCEPTION 'A store can have at most 5 nudge templates';
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  IF NEW.is_default THEN
    UPDATE public.location_nudge_templates SET is_default = false
      WHERE location_id = NEW.location_id AND id <> NEW.id AND is_default;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_nudge_templates_before_write BEFORE INSERT OR UPDATE ON public.location_nudge_templates
  FOR EACH ROW EXECUTE FUNCTION public.nudge_templates_before_write();

CREATE OR REPLACE FUNCTION public.nudge_templates_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_default AND NOT EXISTS (SELECT 1 FROM public.location_nudge_templates WHERE location_id = OLD.location_id AND is_default) THEN
    UPDATE public.location_nudge_templates SET is_default = true
      WHERE id = (SELECT id FROM public.location_nudge_templates WHERE location_id = OLD.location_id ORDER BY sort_order, created_at LIMIT 1);
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_nudge_templates_after_delete AFTER DELETE ON public.location_nudge_templates
  FOR EACH ROW EXECUTE FUNCTION public.nudge_templates_after_delete();

CREATE OR REPLACE FUNCTION public.seed_location_nudge_templates(_location_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.location_nudge_templates WHERE location_id = _location_id) THEN RETURN; END IF;
  INSERT INTO public.location_nudge_templates (location_id, name, body, is_default, sort_order) VALUES
    (_location_id, 'Friendly follow-up', 'Hey, it''s {sender_first_name}. I noticed the {checklist} isn''t done yet and wanted to follow up. Can you make sure it gets finished?', true, 0),
    (_location_id, 'Quick check-in', 'Hey {recipient_first_name}, {sender_first_name} here. The {checklist} is at {done}/{total}. Can you jump on the rest when you get a sec?', false, 1),
    (_location_id, 'Before close', 'It''s {sender_first_name}. The {checklist} needs to be finished soon. Please wrap it up and let me know if anything''s blocking you.', false, 2),
    (_location_id, 'Thanks team', 'Hi team, it''s {sender_first_name}. The {checklist} still has a few items left ({done}/{total} done). Thanks for taking care of it!', false, 3);
END $$;
REVOKE ALL ON FUNCTION public.seed_location_nudge_templates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_location_nudge_templates(uuid) TO service_role;

SELECT public.seed_location_nudge_templates(id) FROM public.locations;

CREATE OR REPLACE FUNCTION public.locations_seed_nudge_templates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.seed_location_nudge_templates(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_locations_seed_nudge_templates AFTER INSERT ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.locations_seed_nudge_templates();

CREATE OR REPLACE FUNCTION public.checklist_nudge_status(_location_id uuid, _checklist_id uuid DEFAULT NULL)
RETURNS TABLE(checklist_id uuid, family_id uuid, title text, frequency text, template_type text, lock_until_time time,
  is_locked boolean, total_items int, completed_items int, is_complete boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  tz text; bd date; w_start timestamptz; w_end timestamptz; m_start timestamptz; m_end timestamptz;
  local_now timestamp; dow int; now_secs int; days_left int;
BEGIN
  SELECT COALESCE((SELECT ls.timezone FROM public.location_settings ls WHERE ls.location_id = _location_id LIMIT 1), 'America/Los_Angeles') INTO tz;
  bd := public.business_date(_location_id);
  SELECT w.start_at, w.end_at INTO w_start, w_end FROM public.business_day_window(_location_id, bd) w;
  local_now := now() AT TIME ZONE tz;
  dow := (EXTRACT(DOW FROM local_now)::int + 6) % 7;
  now_secs := EXTRACT(HOUR FROM local_now)::int * 3600 + EXTRACT(MINUTE FROM local_now)::int * 60 + floor(EXTRACT(SECOND FROM local_now))::int
    + CASE WHEN bd <> local_now::date THEN 86400 ELSE 0 END;
  m_start := date_trunc('month', local_now) AT TIME ZONE tz;
  m_end := (date_trunc('month', local_now) + interval '1 month') AT TIME ZONE tz;
  days_left := EXTRACT(DAY FROM (date_trunc('month', local_now) + interval '1 month - 1 day'))::int - EXTRACT(DAY FROM local_now)::int;
  RETURN QUERY
  WITH cl AS (
    SELECT c.id AS cid, COALESCE(c.family_id, c.id) AS fam, c.title AS t, c.frequency AS f, c.template_type AS tt, c.lock_until_time AS lk,
      CASE WHEN c.frequency = 'monthly' THEN m_start ELSE w_start END AS ps,
      CASE WHEN c.frequency = 'monthly' THEN m_end ELSE w_end END AS pe
    FROM public.checklists c
    WHERE c.location_id = _location_id AND c.is_active AND c.superseded_at IS NULL
      AND COALESCE(c.template_type, '') <> 'training' AND COALESCE(c.frequency, '') <> 'training'
      AND (_checklist_id IS NULL OR c.id = _checklist_id)
      AND (CASE
        WHEN c.template_type = 'dynamic' THEN EXISTS (SELECT 1 FROM public.checklist_items i WHERE i.checklist_id = c.id AND i.deleted_at IS NULL AND dow = ANY(i.days_of_week))
        WHEN c.frequency = 'monthly' AND COALESCE(c.visible_days_before_month_end, 0) > 0 THEN days_left < c.visible_days_before_month_end
        ELSE true END)
  ), items AS (
    SELECT cl.cid, i.id AS iid, i.item_type AS ity, i.order_index AS oi,
      (SELECT max(h.order_index) FROM public.checklist_items h
        WHERE h.checklist_id = cl.cid AND h.item_type = 'section_header' AND h.order_index <= i.order_index
          AND (h.deleted_at IS NULL OR h.deleted_at >= cl.ps)) AS anchor
    FROM cl JOIN public.checklist_items i ON i.checklist_id = cl.cid
    WHERE (i.deleted_at IS NULL OR i.deleted_at >= cl.ps)
      AND (i.item_type = 'section_header' OR COALESCE(cl.tt, '') <> 'dynamic' OR dow = ANY(i.days_of_week))
  ), ans AS (
    SELECT DISTINCT cl.cid, cr.item_id AS iid
    FROM cl
    JOIN public.checklist_submissions cs ON cs.checklist_id = cl.cid AND cs.location_id = _location_id
    JOIN public.checklist_responses cr ON cr.submission_id = cs.id
    WHERE cr.created_at >= cl.ps AND cr.created_at <= cl.pe AND cr.item_id IS NOT NULL
  ), done_sec AS (
    SELECT DISTINCT it.cid, it.anchor FROM items it JOIN ans a ON a.cid = it.cid AND a.iid = it.iid
    WHERE it.ity <> 'section_header' AND it.anchor IS NOT NULL
  ), cnt AS (
    SELECT it.cid, count(*)::int AS tot,
      (count(*) FILTER (WHERE it.ity <> 'section_header' AND EXISTS (SELECT 1 FROM ans a WHERE a.cid = it.cid AND a.iid = it.iid))
       + count(*) FILTER (WHERE it.ity = 'section_header' AND EXISTS (SELECT 1 FROM done_sec d WHERE d.cid = it.cid AND d.anchor = it.oi)))::int AS comp
    FROM items it GROUP BY it.cid
  )
  SELECT cl.cid, cl.fam, cl.t, cl.f, cl.tt, cl.lk,
    (cl.lk IS NOT NULL AND now_secs < EXTRACT(EPOCH FROM cl.lk)::int),
    COALESCE(cnt.tot, 0), COALESCE(cnt.comp, 0),
    (COALESCE(cnt.tot, 0) > 0 AND COALESCE(cnt.comp, 0) >= COALESCE(cnt.tot, 0))
  FROM cl LEFT JOIN cnt ON cnt.cid = cl.cid;
END $$;
REVOKE ALL ON FUNCTION public.checklist_nudge_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checklist_nudge_status(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.record_checklist_nudges(
  _batch uuid, _sender uuid, _location uuid, _org uuid, _checklist uuid, _family uuid, _title text,
  _template_id uuid, _message_raw text, _recipients jsonb, _source text, _business_date date, _cooldown_min int DEFAULT 60)
RETURNS TABLE(recipient_id uuid, status text, log_id uuid, last_sent_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE r jsonb; rid uuid; last_at timestamptz; new_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_family::text, 0));
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_recipients, '[]'::jsonb)) LOOP
    rid := (r->>'id')::uuid;
    SELECT max(l.created_at) INTO last_at FROM public.checklist_nudge_log l
      WHERE l.checklist_family_id = _family AND l.recipient_id = rid AND l.created_at > now() - make_interval(mins => _cooldown_min);
    IF last_at IS NOT NULL THEN
      recipient_id := rid; status := 'cooldown'; log_id := NULL; last_sent_at := last_at; RETURN NEXT;
    ELSE
      INSERT INTO public.checklist_nudge_log (batch_id, organization_id, location_id, checklist_id, checklist_family_id, checklist_title,
        sender_id, recipient_id, template_id, message_raw, message_sent, source, business_date)
      VALUES (_batch, _org, _location, _checklist, _family, _title, _sender, rid, _template_id, _message_raw, r->>'message_sent', _source, _business_date)
      RETURNING id INTO new_id;
      recipient_id := rid; status := 'queued'; log_id := new_id; last_sent_at := now(); RETURN NEXT;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.record_checklist_nudges(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_checklist_nudges(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, date, int) TO service_role;
REVOKE ALL ON FUNCTION public.nudge_templates_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nudge_templates_after_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.locations_seed_nudge_templates() FROM PUBLIC, anon, authenticated;
