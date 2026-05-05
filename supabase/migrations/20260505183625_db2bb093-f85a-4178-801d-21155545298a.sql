CREATE OR REPLACE FUNCTION public.update_tracker_across_locations(
  _original_title text,
  _config jsonb,
  _location_ids uuid[]
)
RETURNS TABLE(location_id uuid, users_updated int, users_created int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  loc uuid;
  is_allowed boolean;
  updated_count int;
  created_count int;
  next_order int;
  u record;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_super_admin(caller) OR public.has_role_or_higher(caller, 'admin')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  FOREACH loc IN ARRAY _location_ids LOOP
    SELECT EXISTS(SELECT 1 FROM public.get_publishable_locations(caller) g WHERE g.id = loc) INTO is_allowed;
    IF NOT is_allowed THEN CONTINUE; END IF;

    updated_count := 0;
    created_count := 0;

    FOR u IN
      SELECT DISTINCT ul.user_id FROM public.user_locations ul WHERE ul.location_id = loc
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.user_dashboard_cubes
        WHERE user_id = u.user_id AND location_id = loc AND cube_type = 'tracker'
          AND COALESCE(title, '') = COALESCE(_original_title, '')
      ) THEN
        UPDATE public.user_dashboard_cubes SET
          title = _config->>'title',
          accent_color = COALESCE(_config->>'accent_color', accent_color),
          tracker_scope = COALESCE(_config->'tracker_scope', tracker_scope),
          tracker_display_mode = COALESCE(_config->>'tracker_display_mode', tracker_display_mode),
          tracker_item_refs = COALESCE(_config->'tracker_item_refs', tracker_item_refs),
          tracker_promo_start = NULLIF(_config->>'tracker_promo_start','')::date,
          tracker_promo_end = NULLIF(_config->>'tracker_promo_end','')::date,
          tracker_promo_image_url = _config->>'tracker_promo_image_url',
          tracker_location_refs = COALESCE(_config->'tracker_location_refs', tracker_location_refs),
          tracker_rank_metrics = COALESCE(_config->'tracker_rank_metrics', tracker_rank_metrics),
          updated_at = now()
        WHERE user_id = u.user_id AND location_id = loc AND cube_type = 'tracker'
          AND COALESCE(title, '') = COALESCE(_original_title, '');
        updated_count := updated_count + 1;
      ELSE
        SELECT COALESCE(MAX(display_order), -1) + 1 INTO next_order
        FROM public.user_dashboard_cubes WHERE user_id = u.user_id AND location_id = loc;

        INSERT INTO public.user_dashboard_cubes (
          user_id, location_id, title, cube_type, widget_size, metrics, accent_color, display_order,
          tracker_scope, tracker_display_mode, tracker_item_refs, tracker_promo_start, tracker_promo_end,
          tracker_promo_image_url, tracker_location_refs, tracker_rank_metrics
        ) VALUES (
          u.user_id, loc, _config->>'title', 'tracker',
          COALESCE(_config->>'widget_size', 'large'),
          COALESCE(_config->'metrics', '[]'::jsonb),
          COALESCE(_config->>'accent_color', '#8B5CF6'),
          next_order,
          COALESCE(_config->'tracker_scope', '{"type":"location"}'::jsonb),
          COALESCE(_config->>'tracker_display_mode', 'expandable'),
          COALESCE(_config->'tracker_item_refs', '[]'::jsonb),
          NULLIF(_config->>'tracker_promo_start','')::date,
          NULLIF(_config->>'tracker_promo_end','')::date,
          _config->>'tracker_promo_image_url',
          COALESCE(_config->'tracker_location_refs', '[]'::jsonb),
          COALESCE(_config->'tracker_rank_metrics', '["units","sales","pmix"]'::jsonb)
        );
        created_count := created_count + 1;
      END IF;
    END LOOP;

    location_id := loc;
    users_updated := updated_count;
    users_created := created_count;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tracker_across_locations(text, jsonb, uuid[]) TO authenticated;