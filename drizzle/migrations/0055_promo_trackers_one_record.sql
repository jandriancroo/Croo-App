CREATE TABLE public.promo_trackers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('brand','org')),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ended_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK ((owner_type = 'brand' AND brand_id IS NOT NULL AND organization_id IS NULL)
      OR (owner_type = 'org' AND organization_id IS NOT NULL))
);
CREATE TABLE public.promo_tracker_locations (
  promo_id uuid NOT NULL REFERENCES public.promo_trackers(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  PRIMARY KEY (promo_id, location_id)
);
CREATE INDEX promo_trackers_brand_idx ON public.promo_trackers (brand_id) WHERE ended_at IS NULL;
CREATE INDEX promo_trackers_org_idx ON public.promo_trackers (organization_id) WHERE ended_at IS NULL;

GRANT SELECT ON public.promo_trackers TO authenticated;
GRANT SELECT ON public.promo_tracker_locations TO authenticated;
GRANT ALL ON public.promo_trackers TO service_role;
GRANT ALL ON public.promo_tracker_locations TO service_role;
ALTER TABLE public.promo_trackers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_tracker_locations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._can_manage_promo(_uid uuid, _owner_type text, _brand_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.is_super_admin(_uid)
    OR (_owner_type = 'brand' AND EXISTS (SELECT 1 FROM public.brand_members bm
          WHERE bm.user_id = _uid AND bm.brand_id = _brand_id AND bm.brand_role = 'admin'))
    OR (_owner_type = 'org' AND public.is_org_admin(_uid, _org_id))
  )
$$;

-- Managers of a promo can read the raw rows; everyone else reads through get_active_promo_tracker.
CREATE POLICY "Promo owners read promos" ON public.promo_trackers FOR SELECT TO authenticated
  USING (public._can_manage_promo((SELECT auth.uid()), owner_type, brand_id, organization_id));
CREATE POLICY "Promo owners read promo locations" ON public.promo_tracker_locations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.promo_trackers p WHERE p.id = promo_id
    AND public._can_manage_promo((SELECT auth.uid()), p.owner_type, p.brand_id, p.organization_id)));

CREATE OR REPLACE FUNCTION public._promo_json(_p public.promo_trackers, _uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', _p.id, 'owner_type', _p.owner_type, 'brand_id', _p.brand_id,
    'organization_id', _p.organization_id, 'title', _p.title,
    'starts_on', _p.starts_on, 'ends_on', _p.ends_on, 'config', _p.config,
    'location_ids', COALESCE((SELECT jsonb_agg(location_id) FROM public.promo_tracker_locations WHERE promo_id = _p.id), '[]'::jsonb),
    'can_manage', public._can_manage_promo(_uid, _p.owner_type, _p.brand_id, _p.organization_id)
  )
$$;

-- The one promo a location shows right now: brand promo first, then the org contest.
CREATE OR REPLACE FUNCTION public.get_active_promo_tracker(_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _brand uuid; _org uuid; _today date; _p public.promo_trackers;
BEGIN
  IF _uid IS NULL OR NOT (public.has_location_access(_uid, _location_id) OR public.is_super_admin(_uid)) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(l.brand_id, o.brand_id), l.organization_id INTO _brand, _org
    FROM public.locations l LEFT JOIN public.organizations o ON o.id = l.organization_id WHERE l.id = _location_id;
  SELECT (now() AT TIME ZONE COALESCE(NULLIF(ls.timezone,''), 'America/Los_Angeles'))::date INTO _today
    FROM (SELECT 1) x LEFT JOIN public.location_settings ls ON ls.location_id = _location_id;
  _today := COALESCE(_today, (now() AT TIME ZONE 'America/Los_Angeles')::date);

  SELECT * INTO _p FROM public.promo_trackers
   WHERE owner_type = 'brand' AND brand_id = _brand AND ended_at IS NULL
     AND _today BETWEEN starts_on AND ends_on
   ORDER BY starts_on DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT p.* INTO _p FROM public.promo_trackers p
     WHERE p.owner_type = 'org' AND p.organization_id = _org AND p.ended_at IS NULL
       AND _today BETWEEN p.starts_on AND p.ends_on
       AND (NOT EXISTS (SELECT 1 FROM public.promo_tracker_locations x WHERE x.promo_id = p.id)
            OR EXISTS (SELECT 1 FROM public.promo_tracker_locations x WHERE x.promo_id = p.id AND x.location_id = _location_id))
     ORDER BY p.starts_on DESC LIMIT 1;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  RETURN public._promo_json(_p, _uid);
END $$;

-- Current + upcoming promos for this location's brand and org (for the builder list).
CREATE OR REPLACE FUNCTION public.list_promo_trackers(_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _brand uuid; _org uuid;
BEGIN
  IF _uid IS NULL OR NOT (public.has_location_access(_uid, _location_id) OR public.is_super_admin(_uid)) THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(l.brand_id, o.brand_id), l.organization_id INTO _brand, _org
    FROM public.locations l LEFT JOIN public.organizations o ON o.id = l.organization_id WHERE l.id = _location_id;
  RETURN COALESCE((
    SELECT jsonb_agg(public._promo_json(p, _uid) ORDER BY p.starts_on)
      FROM public.promo_trackers p
     WHERE p.ended_at IS NULL AND p.ends_on >= (now() AT TIME ZONE 'America/Los_Angeles')::date - 1
       AND ((p.owner_type = 'brand' AND p.brand_id = _brand) OR (p.owner_type = 'org' AND p.organization_id = _org))
       AND public._can_manage_promo(_uid, p.owner_type, p.brand_id, p.organization_id)
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.save_promo_tracker(
  _id uuid, _owner_type text, _brand_id uuid, _organization_id uuid,
  _title text, _starts_on date, _ends_on date, _config jsonb, _location_ids uuid[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _clash public.promo_trackers; _new uuid; _old public.promo_trackers;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _owner_type = 'brand' THEN _organization_id := NULL; END IF;
  IF _owner_type = 'org' THEN _brand_id := NULL; END IF;
  IF btrim(coalesce(_title,'')) = '' THEN RAISE EXCEPTION 'Give the promo a name'; END IF;
  IF _starts_on IS NULL OR _ends_on IS NULL OR _ends_on < _starts_on THEN
    RAISE EXCEPTION 'Pick a start date and an end date on or after it';
  END IF;
  IF _id IS NOT NULL THEN
    SELECT * INTO _old FROM public.promo_trackers WHERE id = _id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Promo not found'; END IF;
    IF NOT public._can_manage_promo(_uid, _old.owner_type, _old.brand_id, _old.organization_id) THEN
      RAISE EXCEPTION 'You can''t edit this promo';
    END IF;
  END IF;
  IF NOT public._can_manage_promo(_uid, _owner_type, _brand_id, _organization_id) THEN
    RAISE EXCEPTION 'Only brand admins can create brand promos, and only org admins can create org contests';
  END IF;

  SELECT * INTO _clash FROM public.promo_trackers p
   WHERE p.ended_at IS NULL AND p.id IS DISTINCT FROM _id AND p.owner_type = _owner_type
     AND ((_owner_type = 'brand' AND p.brand_id = _brand_id) OR (_owner_type = 'org' AND p.organization_id = _organization_id))
     AND daterange(p.starts_on, p.ends_on, '[]') && daterange(_starts_on, _ends_on, '[]')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This overlaps %, % to %', _clash.title,
      to_char(_clash.starts_on, 'Mon FMDD'), to_char(_clash.ends_on, 'Mon FMDD');
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.promo_trackers (owner_type, brand_id, organization_id, title, starts_on, ends_on, config, created_by)
    VALUES (_owner_type, _brand_id, _organization_id, btrim(_title), _starts_on, _ends_on, COALESCE(_config,'{}'::jsonb), _uid)
    RETURNING id INTO _new;
  ELSE
    UPDATE public.promo_trackers SET owner_type = _owner_type, brand_id = _brand_id, organization_id = _organization_id,
      title = btrim(_title), starts_on = _starts_on, ends_on = _ends_on, config = COALESCE(_config,'{}'::jsonb), updated_at = now()
    WHERE id = _id;
    _new := _id;
  END IF;

  DELETE FROM public.promo_tracker_locations WHERE promo_id = _new;
  IF _owner_type = 'org' AND _location_ids IS NOT NULL THEN
    INSERT INTO public.promo_tracker_locations (promo_id, location_id)
    SELECT _new, l.id FROM public.locations l WHERE l.id = ANY(_location_ids) AND l.organization_id = _organization_id;
  END IF;
  RETURN _new;
END $$;

CREATE OR REPLACE FUNCTION public.end_promo_tracker(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _p public.promo_trackers;
BEGIN
  SELECT * INTO _p FROM public.promo_trackers WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promo not found'; END IF;
  IF NOT public._can_manage_promo(_uid, _p.owner_type, _p.brand_id, _p.organization_id) THEN
    RAISE EXCEPTION 'You can''t end this promo';
  END IF;
  UPDATE public.promo_trackers SET ended_at = now(), updated_at = now() WHERE id = _id;
END $$;

REVOKE ALL ON FUNCTION public._can_manage_promo(uuid,text,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._promo_json(public.promo_trackers,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_active_promo_tracker(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_promo_trackers(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_promo_tracker(uuid,text,uuid,uuid,text,date,date,jsonb,uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_promo_tracker(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_manage_promo(uuid,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_promo_tracker(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_promo_trackers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_promo_tracker(uuid,text,uuid,uuid,text,date,date,jsonb,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_promo_tracker(uuid) TO authenticated;

-- Wipe old per-location tracker copies, with a restorable backup first.
CREATE TABLE public.promo_tracker_wipe_backup_2026_10 AS
  SELECT * FROM public.dashboard_widgets WHERE widget_type = 'tracker';
GRANT ALL ON public.promo_tracker_wipe_backup_2026_10 TO service_role;
ALTER TABLE public.promo_tracker_wipe_backup_2026_10 ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.promo_tracker_wipe_backup_2026_10 IS 'Backup of dashboard_widgets tracker rows removed 2026-10-21 when promos moved to promo_trackers. Restore by re-inserting.';

-- Carry Spellbound Spread over as ONE brand promo (same dates, items, image) so there is no gap.
INSERT INTO public.promo_trackers (owner_type, brand_id, title, starts_on, ends_on, config, created_by)
SELECT 'brand', '5f805404-cc7b-454b-a994-fe5901c32e6a', 'Spellbound Spread', DATE '2026-08-19', DATE '2026-10-27',
  jsonb_build_object(
    'tracker_display_mode', w.config->'tracker_display_mode',
    'tracker_item_refs', w.config->'tracker_item_refs',
    'tracker_promo_image_url', w.config->'tracker_promo_image_url',
    'tracker_rank_metrics', w.config->'tracker_rank_metrics',
    'tracker_item_images', '{}'::jsonb,
    'tracker_start_on_campaign', false,
    'tracker_autoplay', true,
    'tracker_border', null,
    'tracker_border_winner', false,
    'tracker_border_closing', false),
  w.created_by
FROM public.dashboard_widgets w
WHERE w.id = 'a06adda0-076c-42a9-a309-fb84f39bfcde';

DELETE FROM public.dashboard_widgets WHERE widget_type = 'tracker';
COMMENT ON FUNCTION public.end_promo_tracker_by_title(text) IS 'DEPRECATED: promos live in promo_trackers; use end_promo_tracker(id).';