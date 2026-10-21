-- Smart Close checks. Run as one statement batch with the database query tool (service role claims set below).
-- Every row must say PASS.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

WITH stores AS (SELECT id, name FROM public.locations WHERE name IN ('Hemet', 'Hayward')),
checks AS (
  -- 1) Parity: smart off = today's numbers exactly (only the two new keys are added).
  SELECT 'parity smart-off: ' || s.name AS name,
         (public.get_labor_pace(s.id) - 'smart_close' - 'smart_close_minutes') = public._labor_pace_baseline(s.id)
         AND (public.get_labor_pace(s.id)->>'smart_close')::boolean = false AS ok
    FROM stores s
  UNION ALL
  -- Smart on keeps everything except remaining/pace numbers and per-closer expected_out.
  SELECT 'smart-on keeps worked numbers: ' || s.name,
         (public._labor_pace_core(s.id, NULL, true)->'worked_hours') IS NOT DISTINCT FROM (public._labor_pace_baseline(s.id)->'worked_hours')
         AND (public._labor_pace_core(s.id, NULL, true)->'worked_labor_dollars') IS NOT DISTINCT FROM (public._labor_pace_baseline(s.id)->'worked_labor_dollars')
    FROM stores s
  UNION ALL
  -- 2) Closer rule.
  SELECT 'closer: end at close (hours)', public._labor_closer_rule('2026-10-20 22:00-07', '2026-10-20 22:00-07', '2026-10-20 23:00-07') = 'hours'
  UNION ALL SELECT 'closer: latest-out within 30 min', public._labor_closer_rule('2026-10-20 21:40-07', '2026-10-20 22:00-07', '2026-10-20 22:00-07') = 'latest'
  UNION ALL SELECT 'closer: both', public._labor_closer_rule('2026-10-20 22:00-07', '2026-10-20 22:00-07', '2026-10-20 22:00-07') = 'both'
  UNION ALL SELECT 'closer: mid is not a closer', public._labor_closer_rule('2026-10-20 17:00-07', '2026-10-20 22:00-07', '2026-10-20 22:00-07') IS NULL
  UNION ALL SELECT 'closer: no hours = latest-out only', public._labor_closer_rule('2026-10-20 21:45-07', NULL, '2026-10-20 22:00-07') = 'latest'
         AND public._labor_closer_rule('2026-10-20 20:00-07', NULL, '2026-10-20 22:00-07') IS NULL
  UNION ALL SELECT 'close time: overnight goes to next day',
         public._labor_close_at_from('2026-10-20', '11:00', '01:00', false, 'America/Los_Angeles') = '2026-10-21 01:00-07'::timestamptz
  UNION ALL SELECT 'close time: same day', public._labor_close_at_from('2026-10-20', '11:00', '22:00', false, 'America/Los_Angeles') = '2026-10-20 22:00-07'::timestamptz
  UNION ALL SELECT 'close time: 24h / closed / missing = none',
         public._labor_close_at_from('2026-10-20', '00:00', '00:00', false, 'America/Los_Angeles') IS NULL
         AND public._labor_close_at_from('2026-10-20', '11:00', '22:00', true, 'America/Los_Angeles') IS NULL
         AND public._labor_close_at_from('2026-10-20', NULL, NULL, false, 'America/Los_Angeles') IS NULL
  UNION ALL
  -- 3) Learning-data cleaning.
  SELECT 'clean: missing clock-out', public._labor_outcome_exclude(NULL, false, false, NULL) = 'missing_out'
  UNION ALL SELECT 'clean: auto clock-out', public._labor_outcome_exclude(now(), true, false, 5) = 'auto_closed'
  UNION ALL SELECT 'clean: manager-corrected clock-out', public._labor_outcome_exclude(now(), false, true, 5) = 'edited'
  UNION ALL SELECT 'clean: over 3 hours (forgotten punch)', public._labor_outcome_exclude(now(), false, false, 181) = 'over_3h'
         AND public._labor_outcome_exclude(now(), false, false, -181) = 'over_3h'
  UNION ALL SELECT 'clean: normal close kept', public._labor_outcome_exclude(now(), false, false, 25) IS NULL
  UNION ALL
  -- 4) Smart-on adjustments (closer at 22:00, now 20:00, 2h remaining).
  SELECT 'smart: late close adds time', (SELECT a.exp_out = '2026-10-20 22:20-07' AND a.remaining_sec = 7200 + 1200
          FROM public._labor_smart_close_adjust('working', '2026-10-20 22:00-07', '2026-10-20 20:00-07', 7200, 20) a)
  UNION ALL SELECT 'smart: early close removes time', (SELECT a.exp_out = '2026-10-20 21:45-07' AND a.remaining_sec = 7200 - 900
          FROM public._labor_smart_close_adjust('working', '2026-10-20 22:00-07', '2026-10-20 20:00-07', 7200, -15) a)
  UNION ALL SELECT 'smart: never earlier than now', (SELECT a.exp_out = '2026-10-20 21:50-07' AND a.remaining_sec = 0
          FROM public._labor_smart_close_adjust('working', '2026-10-20 22:00-07', '2026-10-20 21:50-07', 600, -60) a)
  UNION ALL SELECT 'smart: past scheduled end is untouched', (SELECT a.exp_out IS NULL AND a.remaining_sec = 0
          FROM public._labor_smart_close_adjust('over_schedule', '2026-10-20 22:00-07', '2026-10-20 22:10-07', 0, 30) a)
  UNION ALL SELECT 'smart: already left is untouched', (SELECT a.exp_out IS NULL AND a.remaining_sec = 0
          FROM public._labor_smart_close_adjust('done', '2026-10-20 22:00-07', '2026-10-20 20:00-07', 0, 30) a)
  UNION ALL SELECT 'smart: no habit = schedule', (SELECT a.exp_out IS NULL AND a.remaining_sec = 7200
          FROM public._labor_smart_close_adjust('working', '2026-10-20 22:00-07', '2026-10-20 20:00-07', 7200, NULL) a)
  UNION ALL SELECT 'trust: n/(n+8)', (SELECT bool_and(h.trust = round(h.n::numeric / (h.n + 8), 4)) FROM public.labor_close_habits h WHERE h.scope <> 'store')
  UNION ALL SELECT 'no store switched on', NOT EXISTS (SELECT 1 FROM public.labor_smart_close_settings WHERE enabled)
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM checks;
