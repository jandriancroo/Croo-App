-- Shift Marketplace redesign.
-- 1) Offer-someone-else's-shift RLS: add general_manager and require access to the shift's store.
-- 2) Atomic manager actions: approve_shift_offer, assign_shift_offer, deny_shift_offer_claim, undo_shift_offer (10 min).
-- 3) Push: tell every other claimer when the shift went to someone else ('lost_claimer').
-- Punch / kiosk logic is untouched.

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public._is_shift_manager_plus(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = _user_id
      AND role IN ('manager','general_manager','admin','org_admin','brand_admin','super_admin')
  )
$$;
REVOKE ALL ON FUNCTION public._is_shift_manager_plus(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_shift_manager_plus(uuid) TO authenticated;

ALTER TABLE public.shift_offers ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.shift_offers ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.shift_offers ADD COLUMN IF NOT EXISTS approved_via text;  -- 'approve' | 'assign'

-- True once the shift has started in the store's timezone (location_settings.timezone, default America/Los_Angeles).
CREATE OR REPLACE FUNCTION public._shift_has_started(_shift_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (ss.shift_date + ss.start_time) <= (now() AT TIME ZONE coalesce(ls.timezone, 'America/Los_Angeles'))
  FROM scheduled_shifts ss
  JOIN schedules sc ON sc.id = ss.schedule_id
  LEFT JOIN location_settings ls ON ls.location_id = sc.location_id
  WHERE ss.id = _shift_id
$$;
REVOKE ALL ON FUNCTION public._shift_has_started(uuid) FROM PUBLIC, anon, authenticated;

-- ---------- 1) RLS ----------
DROP POLICY IF EXISTS "Admins/managers can offer shifts" ON public.shift_offers;
CREATE POLICY "Admins/managers can offer shifts"
ON public.shift_offers
FOR INSERT
WITH CHECK (
  public._is_shift_manager_plus(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.scheduled_shifts ss
    JOIN public.schedules sc ON sc.id = ss.schedule_id
    WHERE ss.id = shift_offers.shift_id
      AND ss.user_id = shift_offers.offered_by_user_id
      AND public.has_location_access(auth.uid(), sc.location_id)
  )
);

-- ---------- 2) RPCs ----------
-- Loads + locks the offer and its shift and checks the caller. Raises on any failure.
CREATE OR REPLACE FUNCTION public._shift_offer_guard(_offer_id uuid, OUT o public.shift_offers, OUT shift_id uuid, OUT owner_id uuid, OUT loc uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO o FROM shift_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found' USING ERRCODE = 'P0002'; END IF;
  SELECT ss.id, ss.user_id, sc.location_id INTO s
    FROM scheduled_shifts ss JOIN schedules sc ON sc.id = ss.schedule_id
    WHERE ss.id = o.shift_id FOR UPDATE OF ss;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift no longer exists' USING ERRCODE = 'P0002'; END IF;
  shift_id := s.id; owner_id := s.user_id; loc := s.location_id;
  IF NOT (public._is_shift_manager_plus(auth.uid()) AND public.has_location_access(auth.uid(), loc)) THEN
    RAISE EXCEPTION 'Only a manager at this store can do that' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._shift_offer_guard(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_shift_offer(_offer_id uuid, _claimer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  SELECT * INTO g FROM public._shift_offer_guard(_offer_id);
  IF public._shift_has_started(g.shift_id) THEN RAISE EXCEPTION 'This shift has already started'; END IF;
  IF (g.o).status NOT IN ('available','claimed') THEN RAISE EXCEPTION 'This shift is no longer open'; END IF;
  IF g.owner_id IS DISTINCT FROM (g.o).offered_by_user_id THEN
    RAISE EXCEPTION 'The shift changed since it was offered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shift_offer_claims WHERE shift_offer_id = _offer_id AND user_id = _claimer_id) THEN
    RAISE EXCEPTION 'That person has no pending claim';
  END IF;
  UPDATE shift_offers SET status = 'approved', claimed_by_user_id = _claimer_id, approved_at = now(),
    approved_by_user_id = auth.uid(), approved_via = 'approve', updated_at = now()
  WHERE id = _offer_id;
  UPDATE scheduled_shifts SET user_id = _claimer_id WHERE id = g.shift_id;
END $$;

CREATE OR REPLACE FUNCTION public.assign_shift_offer(_offer_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record;
BEGIN
  SELECT * INTO g FROM public._shift_offer_guard(_offer_id);
  IF public._shift_has_started(g.shift_id) THEN RAISE EXCEPTION 'This shift has already started'; END IF;
  IF (g.o).status NOT IN ('available','claimed') THEN RAISE EXCEPTION 'This shift is no longer open'; END IF;
  IF g.owner_id IS DISTINCT FROM (g.o).offered_by_user_id THEN
    RAISE EXCEPTION 'The shift changed since it was offered';
  END IF;
  IF _user_id = g.owner_id THEN RAISE EXCEPTION 'That person already has this shift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM user_locations WHERE user_id = _user_id AND location_id = g.loc) THEN
    RAISE EXCEPTION 'That person is not at this store';
  END IF;
  -- Instant assign: skip the "needs approval" push for this claim row.
  PERFORM set_config('croo.shift_offer_assign', '1', true);
  INSERT INTO shift_offer_claims (shift_offer_id, user_id) VALUES (_offer_id, _user_id)
    ON CONFLICT (shift_offer_id, user_id) DO NOTHING;
  PERFORM set_config('croo.shift_offer_assign', '', true);
  UPDATE shift_offers SET status = 'approved', claimed_by_user_id = _user_id, approved_at = now(),
    approved_by_user_id = auth.uid(), approved_via = 'assign', updated_at = now()
  WHERE id = _offer_id;
  UPDATE scheduled_shifts SET user_id = _user_id WHERE id = g.shift_id;
END $$;

CREATE OR REPLACE FUNCTION public.deny_shift_offer_claim(_offer_id uuid, _claimer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; nxt uuid;
BEGIN
  SELECT * INTO g FROM public._shift_offer_guard(_offer_id);
  IF (g.o).status NOT IN ('available','claimed') THEN RAISE EXCEPTION 'This shift is no longer open'; END IF;
  DELETE FROM shift_offer_claims WHERE shift_offer_id = _offer_id AND user_id = _claimer_id;
  SELECT user_id INTO nxt FROM shift_offer_claims WHERE shift_offer_id = _offer_id ORDER BY created_at LIMIT 1;
  UPDATE shift_offers SET status = CASE WHEN nxt IS NULL THEN 'available' ELSE 'claimed' END,
    claimed_by_user_id = nxt, updated_at = now()
  WHERE id = _offer_id;
END $$;

-- Undo within 10 minutes (same window as Theo): the shift goes back to the owner, the offer reopens.
CREATE OR REPLACE FUNCTION public.undo_shift_offer(_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; nxt uuid;
BEGIN
  SELECT * INTO g FROM public._shift_offer_guard(_offer_id);
  IF (g.o).status <> 'approved' OR (g.o).approved_at IS NULL OR (g.o).approved_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'Undo is no longer available';
  END IF;
  IF g.owner_id IS DISTINCT FROM (g.o).claimed_by_user_id THEN
    RAISE EXCEPTION 'The shift changed since it was approved';
  END IF;
  IF (g.o).approved_via = 'assign' THEN
    DELETE FROM shift_offer_claims WHERE shift_offer_id = _offer_id AND user_id = (g.o).claimed_by_user_id;
  END IF;
  UPDATE scheduled_shifts SET user_id = (g.o).offered_by_user_id WHERE id = g.shift_id;
  SELECT user_id INTO nxt FROM shift_offer_claims WHERE shift_offer_id = _offer_id ORDER BY created_at LIMIT 1;
  UPDATE shift_offers SET status = CASE WHEN nxt IS NULL THEN 'available' ELSE 'claimed' END,
    claimed_by_user_id = nxt, approved_at = NULL, approved_by_user_id = NULL, approved_via = NULL, updated_at = now()
  WHERE id = _offer_id;
END $$;

REVOKE ALL ON FUNCTION public.approve_shift_offer(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_shift_offer(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deny_shift_offer_claim(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_shift_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_shift_offer(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_shift_offer(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_shift_offer_claim(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_shift_offer(uuid) TO authenticated;

-- Team members' own claims: refuse once the shift has started (rows stay as history).
CREATE OR REPLACE FUNCTION public.trg_shift_offer_claim_not_started() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public._shift_has_started((SELECT shift_id FROM shift_offers WHERE id = NEW.shift_offer_id)) THEN
    RAISE EXCEPTION 'This shift has already started';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_shift_offer_claim_not_started() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shift_offer_claim_not_started ON public.shift_offer_claims;
CREATE TRIGGER shift_offer_claim_not_started BEFORE INSERT ON public.shift_offer_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_shift_offer_claim_not_started();

-- ---------- 3) Push ----------
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
  ELSIF _kind = 'lost_claimer' THEN
    -- Everyone else who raised a hand; _claimer is the winner.
    SELECT array_agg(DISTINCT c.user_id) INTO ids FROM shift_offer_claims c
      WHERE c.shift_offer_id = _offer_id AND c.user_id IS DISTINCT FROM _claimer;
    ttl := 'Shift went to someone else';
    bod := 'Thanks for offering to pick up ' || when_txt || '. It went to a teammate this time.';
  END IF;

  ids := array_remove(ids, NULL);
  IF ids IS NULL OR array_length(ids,1) IS NULL THEN RETURN; END IF;

  INSERT INTO alert_queue (alert_type, dedup_key, location_id, payload)
  VALUES ('shift_offer', 'shift_offer:' || _kind || ':' || _offer_id || ':' || coalesce(_claimer::text,'') || _dedup_suffix, loc,
    jsonb_build_object('user_ids', to_jsonb(ids), 'title', ttl, 'body', bod, 'notification_type', 'shift_approvals',
      'data', jsonb_build_object('type','shift_offer','offer_id',_offer_id,'shift_id',o.shift_id,'url','/messages')  -- /messages opens on the feed; the Shift Swaps bar sits at its top))
  ON CONFLICT (dedup_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public._shift_offer_push(uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_shift_offer_push() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sfx text;
BEGIN
  IF TG_TABLE_NAME = 'shift_offers' THEN
    IF TG_OP = 'INSERT' AND NEW.status = 'available' THEN
      PERFORM _shift_offer_push(NEW.id, 'offered');
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
      -- Suffix with the approval time so a re-approval after Undo still sends.
      sfx := ':' || coalesce(extract(epoch FROM NEW.approved_at)::bigint::text, '');
      PERFORM _shift_offer_push(NEW.id, 'approved_owner', NEW.claimed_by_user_id, sfx);
      PERFORM _shift_offer_push(NEW.id, 'approved_claimer', NEW.claimed_by_user_id, sfx);
      PERFORM _shift_offer_push(NEW.id, 'lost_claimer', NEW.claimed_by_user_id, sfx);
    END IF;
  ELSIF TG_TABLE_NAME = 'shift_offer_claims' AND TG_OP = 'INSERT' THEN
    IF coalesce(current_setting('croo.shift_offer_assign', true), '') <> '1' THEN
      PERFORM _shift_offer_push(NEW.shift_offer_id, 'claimed', NEW.user_id);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RAISE WARNING 'shift offer push failed: %', SQLERRM;  -- never block the offer itself
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_shift_offer_push() FROM PUBLIC, anon, authenticated;
