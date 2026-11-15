-- Temperature tasks need a photo. Typing a number only corrects the reading
-- on a photo that is already saved; it can never stand in for the photo.
--
-- A temperature task is checklist_items.item_type = 'temperature', or a photo
-- task (image / PHOTO) with requires_temperature_validation = true.
-- A photo is response_image_url, or a JSON list of photo links in
-- response_text (multi-photo tasks).
--
-- Rules (checklist_responses, BEFORE INSERT OR UPDATE):
--   * New temperature answers without a photo are rejected.
--   * An edit that removes the photo from a temperature answer is rejected.
--   * Old answers saved before this rule with no photo can still be
--     corrected by shift managers and up (and by server jobs), but not by crew.
--   * Delete / undo is untouched.
-- Rejections use SQLSTATE 23514 and the message prefix temp_photo_required so
-- the app can show "Take the photo first".

CREATE OR REPLACE FUNCTION public._checklist_response_has_photo(_image_url text, _text text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF nullif(btrim(coalesce(_image_url, '')), '') IS NOT NULL THEN
    RETURN true;
  END IF;
  IF _text IS NULL OR btrim(_text) NOT LIKE '[%' THEN
    RETURN false;
  END IF;
  BEGIN
    v := _text::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF jsonb_typeof(v) <> 'array' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM jsonb_array_elements(v) e
    WHERE jsonb_typeof(e) = 'string' AND nullif(btrim(e #>> '{}'), '') IS NOT NULL
  );
END $$;

CREATE OR REPLACE FUNCTION public._guard_temperature_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_temp boolean;
  v_uid uuid := auth.uid();
BEGIN
  -- Server jobs (service role, cron, maintenance) have no end user.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fast path: an update that leaves the photo columns alone on an answer
  -- that already has a photo can't break the rule.
  IF TG_OP = 'UPDATE'
     AND NEW.item_id IS NOT DISTINCT FROM OLD.item_id
     AND NEW.response_image_url IS NOT DISTINCT FROM OLD.response_image_url
     AND NEW.response_text IS NOT DISTINCT FROM OLD.response_text
     AND public._checklist_response_has_photo(OLD.response_image_url, OLD.response_text) THEN
    RETURN NEW;
  END IF;

  SELECT (ci.item_type = 'temperature'
          OR (ci.item_type IN ('image', 'PHOTO') AND coalesce(ci.requires_temperature_validation, false)))
    INTO v_is_temp
    FROM public.checklist_items ci
   WHERE ci.id = NEW.item_id;

  IF NOT coalesce(v_is_temp, false) THEN
    RETURN NEW;
  END IF;

  IF public._checklist_response_has_photo(NEW.response_image_url, NEW.response_text) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'temp_photo_required: Take the photo first'
      USING ERRCODE = '23514';
  END IF;

  -- UPDATE with no photo on the new row.
  IF public._checklist_response_has_photo(OLD.response_image_url, OLD.response_text) THEN
    RAISE EXCEPTION 'temp_photo_required: The temperature photo cannot be removed'
      USING ERRCODE = '23514';
  END IF;

  -- Old answer that never had a photo: managers may still correct it.
  IF public.has_role_or_higher(v_uid, 'shift_manager_in_training') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'temp_photo_required: Take the photo first'
    USING ERRCODE = '23514';
END $$;

REVOKE EXECUTE ON FUNCTION public._guard_temperature_photo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_temperature_photo ON public.checklist_responses;
CREATE TRIGGER trg_guard_temperature_photo
  BEFORE INSERT OR UPDATE ON public.checklist_responses
  FOR EACH ROW EXECUTE FUNCTION public._guard_temperature_photo();
