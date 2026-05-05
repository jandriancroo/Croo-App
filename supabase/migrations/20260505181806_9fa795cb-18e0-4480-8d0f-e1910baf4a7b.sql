
CREATE OR REPLACE FUNCTION public.get_publishable_locations(_user_id uuid)
RETURNS TABLE(id uuid, name text, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.name, l.organization_id
  FROM public.locations l
  WHERE l.is_active = true
    AND (
      public.is_super_admin(_user_id)
      OR (
        public.has_role_or_higher(_user_id, 'admin')
        AND l.organization_id IN (
          SELECT DISTINCT loc.organization_id
          FROM public.user_locations ul
          JOIN public.locations loc ON loc.id = ul.location_id
          WHERE ul.user_id = _user_id
            AND loc.organization_id IS NOT NULL
        )
      )
    )
  ORDER BY l.name
$$;

CREATE OR REPLACE FUNCTION public.publish_tracker_to_locations(
  _config jsonb,
  _location_ids uuid[]
)
RETURNS TABLE(location_id uuid, users_published int, users_skipped int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  loc uuid;
  is_allowed boolean;
  inserted_count int;
  skipped_count int;
  next_order int;
  u record;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.is_super_admin(caller)
    OR public.has_role_or_higher(caller, 'admin')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to publish trackers';
  END IF;

  FOREACH loc IN ARRAY _location_ids LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.get_publishable_locations(caller) g WHERE g.id = loc
    ) INTO is_allowed;

    IF NOT is_allowed THEN
      CONTINUE;
    END IF;

    inserted_count := 0;
    skipped_count := 0;

    FOR u IN
      SELECT DISTINCT ul.user_id
      FROM public.user_locations ul
      WHERE ul.location_id = loc
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.user_dashboard_cubes
        WHERE user_id = u.user_id
          AND location_id = loc
          AND cube_type = 'tracker'
          AND COALESCE(title, '') = COALESCE(_config->>'title', '')
      ) THEN
        skipped_count := skipped_count + 1;
        CONTINUE;
      END IF;

      SELECT COALESCE(MAX(display_order), -1) + 1
      INTO next_order
      FROM public.user_dashboard_cubes
      WHERE user_id = u.user_id AND location_id = loc;

      INSERT INTO public.user_dashboard_cubes (
        user_id, location_id, title, cube_type, widget_size, metrics, accent_color, display_order,
        tracker_scope, tracker_display_mode, tracker_item_refs, tracker_promo_start, tracker_promo_end,
        tracker_promo_image_url, tracker_location_refs, tracker_rank_metrics
      ) VALUES (
        u.user_id,
        loc,
        _config->>'title',
        'tracker',
        COALESCE(_config->>'widget_size', 'large'),
        COALESCE(_config->'metrics', '[]'::jsonb),
        COALESCE(_config->>'accent_color', '#8B5CF6'),
        next_order,
        COALESCE(_config->'tracker_scope', '{"type":"location"}'::jsonb),
        COALESCE(_config->>'tracker_display_mode', 'expandable'),
        COALESCE(_config->'tracker_item_refs', '[]'::jsonb),
        NULLIF(_config->>'tracker_promo_start', '')::date,
        NULLIF(_config->>'tracker_promo_end', '')::date,
        _config->>'tracker_promo_image_url',
        COALESCE(_config->'tracker_location_refs', '[]'::jsonb),
        COALESCE(_config->'tracker_rank_metrics', '["units","sales","pmix"]'::jsonb)
      );
      inserted_count := inserted_count + 1;
    END LOOP;

    location_id := loc;
    users_published := inserted_count;
    users_skipped := skipped_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_publishable_locations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_tracker_to_locations(jsonb, uuid[]) TO authenticated;
