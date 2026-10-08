CREATE OR REPLACE FUNCTION public.original_shift_changes(_location_id uuid, _from date, _to date, _user_id uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid, og_shifts int, kept int, gave_away int, moved_off int, removed int, details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
     OR NOT public.has_location_access(auth.uid(), _location_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH og AS (
    SELECT (e->>'id')::uuid AS shift_id, (e->>'user_id')::uuid AS uid, (e->>'shift_date')::date AS d,
           e->>'start_time' AS st, e->>'end_time' AS et
    FROM public.schedules s, jsonb_array_elements(s.original_shifts_snapshot) e
    WHERE s.location_id = _location_id AND jsonb_typeof(s.original_shifts_snapshot) = 'array'
      AND e->>'user_id' IS NOT NULL
      AND coalesce((e->>'is_time_off')::boolean, false) = false
      AND coalesce((e->>'is_phantom')::boolean, false) = false
      AND (e->>'shift_date')::date BETWEEN _from AND _to
      AND (_user_id IS NULL OR (e->>'user_id')::uuid = _user_id)
  ), res AS (
    SELECT og.*,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.scheduled_shifts ss WHERE ss.id = og.shift_id AND ss.user_id = og.uid) THEN 'kept'
        WHEN l.change_type = 'reassigned' AND l.source = 'shift_offer' THEN 'gave_away'
        WHEN l.change_type = 'removed' THEN 'removed'
        ELSE 'moved_off' END AS outcome,
      l.created_at AS changed_at, l.changed_by, (l.new_shift_data->>'user_id')::uuid AS to_uid
    FROM og
    LEFT JOIN LATERAL (
      SELECT x.* FROM public.schedule_change_log x
      WHERE x.shift_id = og.shift_id AND x.undone_at IS NULL AND x.user_id = og.uid
        AND x.change_type IN ('reassigned','removed')
      ORDER BY x.created_at DESC LIMIT 1) l ON true
  )
  SELECT r.uid, count(*)::int,
    count(*) FILTER (WHERE r.outcome='kept')::int,
    count(*) FILTER (WHERE r.outcome='gave_away')::int,
    count(*) FILTER (WHERE r.outcome='moved_off')::int,
    count(*) FILTER (WHERE r.outcome='removed')::int,
    coalesce(jsonb_agg(jsonb_build_object('shift_date', r.d, 'start_time', r.st, 'end_time', r.et,
      'outcome', r.outcome, 'to_user_name', tp.full_name, 'changed_by_name', cp.full_name, 'changed_at', r.changed_at)
      ORDER BY r.d DESC, r.st DESC), '[]'::jsonb)
  FROM res r
  LEFT JOIN public.profiles tp ON tp.id = r.to_uid AND r.outcome <> 'kept'
  LEFT JOIN public.profiles cp ON cp.id = r.changed_by AND r.outcome <> 'kept'
  GROUP BY r.uid;
END $$;
REVOKE EXECUTE ON FUNCTION public.original_shift_changes(uuid, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.original_shift_changes(uuid, date, date, uuid) TO authenticated;