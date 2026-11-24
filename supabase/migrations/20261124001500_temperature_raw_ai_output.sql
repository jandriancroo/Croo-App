-- Temperature Validation hotfix: show the raw AI output on every row.
-- Root cause: the page feed returned only read-issue counts/reasons (never the
-- raw reads), and fell back to temperature_previous, which is null when the AI
-- saved no number and equals the typed value when someone typed twice.
-- Also: new rows whose photo got no AI number start at scan_count 0 (tracked).

CREATE OR REPLACE FUNCTION public._track_temperature_scan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_edit boolean;
  v_is_scan boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_is_edit := NEW.temperature_edited_at IS NOT NULL;
    v_is_scan := NOT v_is_edit AND NEW.extracted_temperature IS NOT NULL;
    -- Never trust client-sent values for these columns.
    NEW.temperature_ai_original := NULL;
    NEW.temperature_ai_latest := NULL;
    NEW.temperature_scan_count := NULL;
    NEW.temperature_last_scan_at := NULL;
    IF v_is_scan THEN
      NEW.temperature_ai_original := NEW.extracted_temperature;
      NEW.temperature_ai_latest := NEW.extracted_temperature;
      NEW.temperature_scan_count := 1;
      NEW.temperature_last_scan_at := now();
    ELSE
      -- Tracked row whose photo got no AI number (or was typed): 0 scans so far.
      NEW.temperature_scan_count := 0;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: carry forward, then apply a new AI reading if this write is one.
  NEW.temperature_ai_original := OLD.temperature_ai_original;
  NEW.temperature_ai_latest := OLD.temperature_ai_latest;
  NEW.temperature_scan_count := OLD.temperature_scan_count;
  NEW.temperature_last_scan_at := OLD.temperature_last_scan_at;

  v_is_edit := NEW.temperature_edited_at IS DISTINCT FROM OLD.temperature_edited_at;
  -- An AI reading write sets a reading and re-stamps temperature_validated_at
  -- (photo retake in the app, or the server "Rescan" job). Typed fixes always
  -- go through temperature_edited_at, which is the override path.
  v_is_scan := NOT v_is_edit
    AND NEW.extracted_temperature IS NOT NULL
    AND NEW.temperature_validated_at IS DISTINCT FROM OLD.temperature_validated_at;

  IF v_is_scan THEN
    IF OLD.temperature_scan_count IS NULL THEN
      -- First tracked scan on a row saved before tracking began: the old value
      -- may itself have been a scan, so original stays unknown unless it had none.
      IF OLD.extracted_temperature IS NULL THEN
        NEW.temperature_ai_original := NEW.extracted_temperature;
        NEW.temperature_scan_count := 1;
      ELSE
        NEW.temperature_ai_original := NULL;
        NEW.temperature_scan_count := 2;
      END IF;
    ELSE
      NEW.temperature_scan_count := OLD.temperature_scan_count + 1;
      -- Keep the first reading; stays NULL when the row predates tracking.
      -- A tracked row with 0 scans gets its first AI reading now.
      NEW.temperature_ai_original := COALESCE(OLD.temperature_ai_original,
        CASE WHEN OLD.temperature_scan_count = 0 THEN NEW.extracted_temperature END);
    END IF;
    NEW.temperature_ai_latest := NEW.extracted_temperature;
    NEW.temperature_last_scan_at := now();
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public._track_temperature_scan() FROM PUBLIC, anon, authenticated;

-- Expose the raw AI output on every row: every logged read attempt (reason,
-- raw numbers, what was saved), plus what the AI actually saved on the row.
DROP FUNCTION IF EXISTS public.get_temperature_validation_entries(uuid, date, date, text, integer, integer);
CREATE FUNCTION public.get_temperature_validation_entries(
  p_location_id uuid DEFAULT NULL,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text DEFAULT 'all',
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  submission_id uuid,
  item_id uuid,
  created_at timestamptz,
  local_day date,
  location_id uuid,
  location_name text,
  checklist_title text,
  item_question text,
  equipment_type text,
  photo_url text,
  extracted_temperature numeric,
  temperature_valid boolean,
  temperature_unconfirmed boolean,
  temperature_validated_at timestamptz,
  completed_by uuid,
  completer_name text,
  ai_original numeric,
  ai_latest numeric,
  scan_count integer,
  last_scan_at timestamptz,
  edited_at timestamptz,
  edited_by uuid,
  editor_name text,
  editor_email text,
  previous_value numeric,
  read_issue_count integer,
  read_issue_reasons text[],
  raw_ai_attempts jsonb,
  ai_saved_value numeric,
  ai_saved_known boolean,
  tracked boolean,
  is_rescan boolean,
  is_override boolean,
  is_confirmed boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT cr.*, ci.question, ci.equipment_type::text AS equipment_type, c.title AS checklist_title,
           COALESCE(cs.location_id, c.location_id) AS loc_id
      FROM public.checklist_responses cr
      JOIN public.checklist_items ci ON ci.id = cr.item_id
      JOIN public.checklists c ON c.id = ci.checklist_id
      LEFT JOIN public.checklist_submissions cs ON cs.id = cr.submission_id
     WHERE (ci.item_type = 'temperature'
            OR (ci.item_type IN ('image', 'PHOTO') AND COALESCE(ci.requires_temperature_validation, false))
            OR (cr.extracted_temperature IS NOT NULL AND (ci.question ILIKE '%temp%' OR ci.question ILIKE '%thermometer%')))
       AND (cr.response_image_url IS NOT NULL OR cr.response_text LIKE '[%')
       AND (p_location_id IS NULL OR COALESCE(cs.location_id, c.location_id) = p_location_id)
       AND (p_from IS NULL OR cr.created_at >= (p_from - 1)::timestamptz)
       AND (p_to IS NULL OR cr.created_at < (p_to + 2)::timestamptz)
  ), enriched AS (
    SELECT b.*, l.name AS location_name,
           (b.created_at AT TIME ZONE COALESCE(ls.timezone, 'America/Los_Angeles'))::date AS lday,
           COALESCE(NULLIF(btrim(b.response_image_url), ''),
                    substring(b.response_text FROM '"(https?://[^"]+)"')) AS photo,
           (b.temperature_scan_count IS NOT NULL) AS is_tracked,
           (b.temperature_edited_at IS NOT NULL
             AND (b.temperature_last_scan_at IS NULL OR b.temperature_edited_at >= b.temperature_last_scan_at)) AS edit_active
      FROM base b
      LEFT JOIN public.locations l ON l.id = b.loc_id
      LEFT JOIN LATERAL (SELECT s.timezone FROM public.location_settings s WHERE s.location_id = b.loc_id LIMIT 1) ls ON true
  ), issues AS (
    SELECT tri.submission_id, tri.item_id,
           count(*)::int AS n,
           array_agg(DISTINCT tri.reason) AS reasons,
           bool_or(tri.saved_temperature IS NOT NULL) AS any_saved,
           -- Raw numbers only: old rows store [n, n], newer rows [{value: n, ...}].
           jsonb_agg(jsonb_build_object(
             'at', tri.created_at,
             'reason', tri.reason,
             'saved', tri.saved_temperature,
             'values', COALESCE((
               SELECT jsonb_agg(CASE
                        WHEN jsonb_typeof(el) = 'number' THEN el
                        WHEN jsonb_typeof(el) = 'object' AND jsonb_typeof(el -> 'value') = 'number' THEN el -> 'value'
                        ELSE 'null'::jsonb END ORDER BY ord)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(tri.reads) = 'array' THEN tri.reads ELSE '[]'::jsonb END)
                      WITH ORDINALITY AS r(el, ord)), '[]'::jsonb)
           ) ORDER BY tri.created_at) AS attempts
      FROM public.temperature_read_issues tri
     WHERE tri.submission_id IN (SELECT e.submission_id FROM enriched e)
     GROUP BY 1, 2
  ), withai AS (
    SELECT e.*, i.n AS issue_n, i.reasons AS issue_reasons, i.attempts AS issue_attempts,
           -- What the AI itself saved on the row (null = it saved no number).
           CASE
             WHEN e.is_tracked THEN e.temperature_ai_latest
             WHEN NOT e.edit_active THEN e.extracted_temperature
             WHEN e.temperature_previous IS NULL THEN NULL
             WHEN e.temperature_previous IS DISTINCT FROM e.extracted_temperature THEN e.temperature_previous
             -- Typed twice: previous = typed value. If the AI never saved a number, it's manual.
             WHEN i.n IS NOT NULL AND NOT i.any_saved THEN NULL
             ELSE e.temperature_previous
           END AS ai_saved,
           CASE
             WHEN e.is_tracked OR NOT e.edit_active OR e.temperature_previous IS NULL THEN true
             WHEN e.temperature_previous IS DISTINCT FROM e.extracted_temperature THEN true
             WHEN i.n IS NOT NULL AND NOT i.any_saved THEN true
             ELSE false  -- same number before/after with no read log: a confirm (or an unprovable re-type)
           END AS ai_known
      FROM enriched e
      LEFT JOIN issues i ON i.submission_id = e.submission_id AND i.item_id = e.item_id
  ), scored AS (
    SELECT w.*, ep.full_name AS ed_name, ep.email AS ed_email, cp.full_name AS cp_name,
           (w.edit_active AND w.extracted_temperature IS DISTINCT FROM w.ai_saved) AS ovr,
           (COALESCE(w.temperature_scan_count, 0) > 1
              OR COALESCE(w.issue_reasons && ARRAY['unclear','borderline_retake','implausible']::text[], false)) AS rescan
      FROM withai w
      LEFT JOIN public.profiles ep ON ep.id = w.temperature_edited_by
      LEFT JOIN public.profiles cp ON cp.id = w.completed_by
     WHERE (p_from IS NULL OR w.lday >= p_from)
       AND (p_to IS NULL OR w.lday <= p_to)
  ), filtered AS (
    SELECT s.* FROM scored s
     WHERE CASE COALESCE(p_status, 'all')
             WHEN 'original'   THEN s.extracted_temperature IS NOT NULL AND NOT s.rescan AND NOT s.ovr
             WHEN 'rescan'     THEN s.rescan
             WHEN 'override'   THEN s.ovr
             WHEN 'confirmed'  THEN s.edit_active AND NOT s.ovr
             WHEN 'no_reading' THEN s.extracted_temperature IS NULL
             ELSE true
           END
  )
  SELECT f.id, f.submission_id, f.item_id, f.created_at, f.lday, f.loc_id, f.location_name,
         f.checklist_title, f.question, f.equipment_type, f.photo,
         f.extracted_temperature, f.temperature_valid, f.temperature_unconfirmed, f.temperature_validated_at,
         f.completed_by, f.cp_name,
         f.temperature_ai_original, f.temperature_ai_latest, f.temperature_scan_count, f.temperature_last_scan_at,
         f.temperature_edited_at, f.temperature_edited_by, f.ed_name, f.ed_email, f.temperature_previous,
         COALESCE(f.issue_n, 0), f.issue_reasons, COALESCE(f.issue_attempts, '[]'::jsonb),
         f.ai_saved, f.ai_known,
         f.is_tracked, f.rescan, f.ovr, (f.edit_active AND NOT f.ovr),
         count(*) OVER ()
    FROM filtered f
   ORDER BY f.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $$;

REVOKE ALL ON FUNCTION public.get_temperature_validation_entries(uuid, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_temperature_validation_entries(uuid, date, date, text, integer, integer) TO authenticated;
