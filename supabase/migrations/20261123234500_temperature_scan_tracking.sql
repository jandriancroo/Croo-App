-- Temperature Validation (Super Admin): track original scan / re-scan / override.
-- Purely additive: new nullable columns filled by a server trigger, so older app
-- builds (TestFlight) keep inserting/updating exactly as before.
--   temperature_ai_original  first AI reading saved on this answer (never changes)
--   temperature_ai_latest    most recent AI reading (before any typed override)
--   temperature_scan_count   how many AI readings were saved (2+ = re-scanned)
--   temperature_last_scan_at when the latest AI reading was saved
-- Override actor stays server-stamped by _stamp_temperature_edit (auth.uid()).
-- Rows from before this migration keep NULLs here (history is not invented).

ALTER TABLE public.checklist_responses
  ADD COLUMN IF NOT EXISTS temperature_ai_original numeric,
  ADD COLUMN IF NOT EXISTS temperature_ai_latest numeric,
  ADD COLUMN IF NOT EXISTS temperature_scan_count integer,
  ADD COLUMN IF NOT EXISTS temperature_last_scan_at timestamptz;

-- Runs after trg_stamp_temperature_edit (name order), so an edit is already stamped.
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
      NEW.temperature_ai_original := OLD.temperature_ai_original;
    END IF;
    NEW.temperature_ai_latest := NEW.extracted_temperature;
    NEW.temperature_last_scan_at := now();
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public._track_temperature_scan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_track_temperature_scan ON public.checklist_responses;
CREATE TRIGGER trg_track_temperature_scan
  BEFORE INSERT OR UPDATE ON public.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION public._track_temperature_scan();

-- Super Admin page feed: all filters run on the server so nothing is dropped.
-- p_from / p_to are store-local calendar days (inclusive). p_status:
-- all | original | rescan | override | confirmed | no_reading.
CREATE OR REPLACE FUNCTION public.get_temperature_validation_entries(
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
       -- coarse UTC window (±1 day) so the index on created_at is used; exact local day below
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
    SELECT tri.submission_id, tri.item_id, count(*)::int AS n, array_agg(DISTINCT tri.reason) AS reasons
      FROM public.temperature_read_issues tri
     WHERE tri.submission_id IN (SELECT e.submission_id FROM enriched e)
     GROUP BY 1, 2
  ), scored AS (
    SELECT e.*, i.n AS issue_n, i.reasons AS issue_reasons,
           ep.full_name AS ed_name, ep.email AS ed_email, cp.full_name AS cp_name,
           -- Override: a typed number that differs from what the AI read.
           (e.edit_active AND e.extracted_temperature IS DISTINCT FROM
              COALESCE(CASE WHEN e.is_tracked THEN e.temperature_ai_latest END, e.temperature_previous)) AS ovr,
           -- Re-scan: a 2nd+ AI reading saved, or a rejected/retaken photo logged for this task.
           (COALESCE(e.temperature_scan_count, 0) > 1
              OR COALESCE(i.reasons && ARRAY['unclear','borderline_retake','implausible']::text[], false)) AS rescan
      FROM enriched e
      LEFT JOIN issues i ON i.submission_id = e.submission_id AND i.item_id = e.item_id
      LEFT JOIN public.profiles ep ON ep.id = e.temperature_edited_by
      LEFT JOIN public.profiles cp ON cp.id = e.completed_by
     WHERE (p_from IS NULL OR e.lday >= p_from)
       AND (p_to IS NULL OR e.lday <= p_to)
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
         COALESCE(f.issue_n, 0), f.issue_reasons,
         f.is_tracked, f.rescan, f.ovr, (f.edit_active AND NOT f.ovr),
         count(*) OVER ()
    FROM filtered f
   ORDER BY f.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $$;

REVOKE ALL ON FUNCTION public.get_temperature_validation_entries(uuid, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_temperature_validation_entries(uuid, date, date, text, integer, integer) TO authenticated;

-- Andy piggyback: read-issue logs must belong to a store the user can access.
DROP POLICY IF EXISTS "Users log their own temperature read issues" ON public.temperature_read_issues;
CREATE POLICY "Users log their own temperature read issues"
  ON public.temperature_read_issues
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND location_id IS NOT NULL
    AND public.has_location_access(auth.uid(), location_id)
  );
