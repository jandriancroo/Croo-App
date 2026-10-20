CREATE OR REPLACE FUNCTION public._lp_pairs(_location_id uuid, _date date, _src text)
RETURNS TABLE(user_id uuid, clock_in timestamptz, clock_out timestamptz, is_open boolean,
              shift_id uuid, est_end timestamptz, on_break boolean, worked_sec numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF _src = 'punch_clock' THEN
    RETURN QUERY
      SELECT p.user_id, p.clock_in, CASE WHEN p.open_shift_live THEN NULL ELSE p.clock_out END,
             coalesce(p.open_shift_live, false), tp.shift_id, p.estimated_end,
             coalesce(p.open_shift_live AND lb.punch_type = 'break_start', false),
             greatest(coalesce(p.worked_sec, 0) - coalesce(p.unpaid_sec, 0), 0)
        FROM public._labor_pair_shifts(_location_id, _date, true) p
        LEFT JOIN public.time_punches tp ON tp.id = p.clock_in_punch_id
        LEFT JOIN LATERAL (
          SELECT t.punch_type FROM public.time_punches t
           WHERE t.user_id = p.user_id AND t.location_id = _location_id
             AND t.punch_time >= p.clock_in AND t.punch_time <= now()
           ORDER BY t.punch_time DESC LIMIT 1) lb ON true;
  ELSIF _src = 'toast' THEN
    RETURN QUERY
      SELECT ts.croo_user_id, ts.in_time, ts.out_time, ts.out_time IS NULL, ts.croo_scheduled_shift_id,
             ts.in_time + interval '8 hours', false,
             CASE WHEN ts.out_time IS NULL
                  THEN greatest(extract(epoch FROM now() - ts.in_time) - coalesce(ts.unpaid_break_seconds, 0), 0)
                  ELSE coalesce(ts.payable_seconds::numeric,
                       greatest(extract(epoch FROM ts.out_time - ts.in_time) - coalesce(ts.unpaid_break_seconds, 0), 0)) END
        FROM public.toast_shifts ts
       WHERE ts.location_id = _location_id AND ts.shift_date = _date
         AND ts.croo_user_id IS NOT NULL AND ts.in_time IS NOT NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._lp_pairs(uuid, date, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lp_pairs(uuid, date, text) TO service_role;