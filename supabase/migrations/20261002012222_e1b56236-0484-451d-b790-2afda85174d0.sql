CREATE OR REPLACE FUNCTION public._shift_offer_push(_offer_id uuid, _kind text, _claimer uuid DEFAULT NULL, _dedup_suffix text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o record; s record; loc uuid; pos text; when_txt text; owner_name text; claimer_name text;
  ids uuid[]; ttl text; bod text;
BEGIN
  SELECT * INTO o FROM shift_offers WHERE id = _offer_id;
  IF o IS NULL THEN RETURN; END IF;
  SELECT ss.*, sc.location_id AS loc_id INTO s FROM scheduled_shifts ss JOIN schedules sc ON sc.id = ss.schedule_id WHERE ss.id = o.shift_id;
  IF s IS NULL THEN RETURN; END IF;
  loc := s.loc_id;
  SELECT position INTO pos FROM shift_templates WHERE id = s.template_id;
  when_txt := to_char(s.shift_date, 'Dy, Mon FMDD') || ' ' || ltrim(to_char(s.start_time, 'FMHH12:MI AM')) || '–' || ltrim(to_char(s.end_time, 'FMHH12:MI AM'));
  SELECT coalesce(nullif(full_name,''),'A teammate') INTO owner_name FROM profiles WHERE id = o.offered_by_user_id;
  SELECT coalesce(nullif(full_name,''),'Someone') INTO claimer_name FROM profiles WHERE id = _claimer;

  IF _kind = 'offered' THEN
    -- Everyone at the store; skip the owner only when they offered their own shift.
    SELECT array_agg(DISTINCT ul.user_id) INTO ids FROM user_locations ul
      WHERE ul.location_id = loc
        AND NOT (ul.user_id = o.offered_by_user_id AND coalesce(auth.uid(), o.offered_by_user_id) = o.offered_by_user_id);
    ttl := 'Shift up for grabs';
    bod := coalesce(owner_name,'A teammate') || '''s ' || coalesce(pos || ' ', '') || 'shift ' || when_txt || ' is open. Tap to claim.';
  ELSIF _kind = 'claimed' THEN
    SELECT array_agg(DISTINCT ul.user_id) INTO ids FROM user_locations ul JOIN user_roles ur ON ur.user_id = ul.user_id
      WHERE ul.location_id = loc AND ur.role IN ('manager','general_manager','admin','org_admin','brand_admin','super_admin')
        AND ul.user_id <> _claimer;
    ttl := 'Shift pickup needs approval';
    bod := coalesce(claimer_name,'Someone') || ' wants ' || coalesce(owner_name,'a teammate') || '''s shift ' || when_txt || '.';
  ELSIF _kind = 'approved_owner' THEN
    ids := ARRAY[o.offered_by_user_id];
    ttl := 'Your shift is covered';
    bod := 'Your shift ' || when_txt || ' was picked up by ' || coalesce(claimer_name,'a teammate') || '.';
  ELSIF _kind = 'approved_claimer' THEN
    ids := ARRAY[_claimer];
    ttl := 'Shift Claim Approved!';
    bod := 'You''re on for ' || when_txt || '. It shows on your schedule once it''s published.';
  END IF;

  ids := array_remove(ids, NULL);
  IF ids IS NULL OR array_length(ids,1) IS NULL THEN RETURN; END IF;

  INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
  VALUES ('shift_offer', 'shift_offer:' || _kind || ':' || _offer_id || ':' || coalesce(_claimer::text,'') || _dedup_suffix, loc,
    jsonb_build_object('user_ids', to_jsonb(ids), 'title', ttl, 'body', bod, 'notification_type', 'shift_approvals',
      'data', jsonb_build_object('type','shift_offer','offer_id',_offer_id,'shift_id',o.shift_id,'url','/messages')))
  ON CONFLICT (dedup_key) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public._shift_offer_push(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_shift_offer_push() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'shift_offers' THEN
    IF TG_OP = 'INSERT' AND NEW.status = 'available' THEN
      PERFORM _shift_offer_push(NEW.id, 'offered');
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      PERFORM _shift_offer_push(NEW.id, 'approved_owner', NEW.claimed_by_user_id);
      PERFORM _shift_offer_push(NEW.id, 'approved_claimer', NEW.claimed_by_user_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'shift_offer_claims' AND TG_OP = 'INSERT' THEN
    PERFORM _shift_offer_push(NEW.shift_offer_id, 'claimed', NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'shift offer push failed: %', SQLERRM;  -- never block the offer itself
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS shift_offer_push ON public.shift_offers;
CREATE TRIGGER shift_offer_push AFTER INSERT OR UPDATE OF status ON public.shift_offers FOR EACH ROW EXECUTE FUNCTION public.trg_shift_offer_push();
DROP TRIGGER IF EXISTS shift_offer_claim_push ON public.shift_offer_claims;
CREATE TRIGGER shift_offer_claim_push AFTER INSERT ON public.shift_offer_claims FOR EACH ROW EXECUTE FUNCTION public.trg_shift_offer_push();