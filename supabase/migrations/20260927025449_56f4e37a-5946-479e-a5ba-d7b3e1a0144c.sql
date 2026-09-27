-- Package A step 4: triggers and labor_rules write policy
-- A6: cache follows resolutions and rule changes (9/26 and later only)
CREATE OR REPLACE FUNCTION public._labor_cache_refresh_from(_location_id uuid, _from date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_start date; v_end date;
BEGIN
  IF _location_id IS NULL OR public.labor_source_for(_location_id) IS DISTINCT FROM 'punch_clock' THEN RETURN; END IF;
  v_start := greatest(coalesce(_from, public.labor_new_rule_start()), public.labor_new_rule_start());
  v_end := public.business_date(_location_id) - 1;
  UPDATE public.labor_cache SET is_stale = true
   WHERE location_id = _location_id AND source = 'punch_clock' AND labor_date >= v_start;
  IF v_start > v_end THEN RETURN; END IF;
  BEGIN
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/labor-service',
      headers := public.cron_edge_headers(),
      body := jsonb_build_object('action','backfill','locationId',_location_id::text,
                                 'startDate',v_start::text,'endDate',v_end::text,'forceRefresh',true));
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '_labor_cache_refresh_from: net.http_post failed: %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public._labor_cache_refresh_from(uuid, date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_cache_refresh_from(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_labor_resolution_cache()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r record; v_ci timestamptz;
BEGIN
  r := coalesce(NEW, OLD);
  SELECT tp.punch_time INTO v_ci FROM public.time_punches tp WHERE tp.id = r.clock_in_punch_id;
  PERFORM public._labor_cache_refresh_from(r.location_id,
    CASE WHEN v_ci IS NULL THEN NULL ELSE public.business_date(r.location_id, v_ci) END);
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_labor_resolution_cache() FROM public, anon, authenticated;
CREATE TRIGGER trg_labor_resolution_cache AFTER INSERT OR DELETE ON public.labor_shift_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.trg_labor_resolution_cache();

CREATE OR REPLACE FUNCTION public.trg_labor_rules_cache()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.unpaid_break_min_minutes IS DISTINCT FROM OLD.unpaid_break_min_minutes
     OR NEW.max_open_shift_hours IS DISTINCT FROM OLD.max_open_shift_hours
     OR NEW.duplicate_tap_minutes IS DISTINCT FROM OLD.duplicate_tap_minutes
     OR NEW.auto_clock_out_after_close_min IS DISTINCT FROM OLD.auto_clock_out_after_close_min THEN
    PERFORM public._labor_cache_refresh_from(NEW.location_id, NULL);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_labor_rules_cache() FROM public, anon, authenticated;
CREATE TRIGGER trg_labor_rules_cache AFTER UPDATE ON public.labor_rules
  FOR EACH ROW EXECUTE FUNCTION public.trg_labor_rules_cache();

-- A10: address -> state / timezone
CREATE OR REPLACE FUNCTION public._tz_valid_for_state(_state text, _tz text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE _state
    WHEN 'IN' THEN _tz LIKE 'America/Indiana/%' OR _tz IN ('America/Chicago','America/New_York')
    WHEN 'TX' THEN _tz IN ('America/Chicago','America/Denver')
    WHEN 'FL' THEN _tz IN ('America/New_York','America/Chicago')
    WHEN 'TN' THEN _tz IN ('America/Chicago','America/New_York')
    WHEN 'KY' THEN _tz IN ('America/New_York','America/Chicago') OR _tz LIKE 'America/Kentucky/%'
    WHEN 'MI' THEN _tz IN ('America/Detroit','America/Menominee')
    WHEN 'ID' THEN _tz IN ('America/Boise','America/Los_Angeles')
    WHEN 'OR' THEN _tz IN ('America/Los_Angeles','America/Boise')
    WHEN 'ND' THEN _tz IN ('America/Chicago','America/Denver') OR _tz LIKE 'America/North_Dakota/%'
    WHEN 'SD' THEN _tz IN ('America/Chicago','America/Denver')
    WHEN 'NE' THEN _tz IN ('America/Chicago','America/Denver')
    WHEN 'KS' THEN _tz IN ('America/Chicago','America/Denver')
    ELSE false END
$$;
REVOKE ALL ON FUNCTION public._tz_valid_for_state(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tz_valid_for_state(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_location_region()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_st text; v_tz text; v_cur text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.address IS NOT DISTINCT FROM OLD.address THEN RETURN NEW; END IF;
  SELECT d.state_code, d.timezone INTO v_st, v_tz FROM public.derive_store_region(NEW.address) d;
  IF v_st IS NULL THEN
    INSERT INTO public.location_timezone_pending(location_id, kind, address)
    VALUES (NEW.id, 'parse_failed', NEW.address);
    RETURN NEW;
  END IF;

  UPDATE public.labor_rules lr SET state_code = v_st
   WHERE lr.location_id = NEW.id AND lr.state_code IS DISTINCT FROM v_st;
  IF v_st = 'CA' THEN
    UPDATE public.labor_rules lr SET meal_break_hours = coalesce(lr.meal_break_hours, 5),
                                     meal_break_duration = coalesce(lr.meal_break_duration, 30)
     WHERE lr.location_id = NEW.id AND (lr.meal_break_hours IS NULL OR lr.meal_break_duration IS NULL);
  END IF;

  SELECT ls.timezone INTO v_cur FROM public.location_settings ls WHERE ls.location_id = NEW.id;
  IF NOT FOUND OR v_cur IS NOT DISTINCT FROM v_tz OR public._tz_valid_for_state(v_st, v_cur) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.punch_clock_devices d WHERE d.location_id = NEW.id AND d.revoked_at IS NULL) THEN
    INSERT INTO public.location_timezone_pending(location_id, kind, address, derived_state, current_tz, proposed_tz)
    SELECT NEW.id, 'timezone_change', NEW.address, v_st, v_cur, v_tz
     WHERE NOT EXISTS (SELECT 1 FROM public.location_timezone_pending p
                        WHERE p.location_id = NEW.id AND p.status = 'pending' AND p.proposed_tz = v_tz);
  ELSE
    UPDATE public.location_settings SET timezone = v_tz WHERE location_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_location_region() FROM public, anon, authenticated;
CREATE TRIGGER trg_location_region AFTER INSERT OR UPDATE OF address ON public.locations
  FOR EACH ROW EXECUTE FUNCTION public.trg_location_region();

-- A11: labor_rules writes scoped to the store's org
DROP POLICY "Admins can manage labor rules" ON public.labor_rules;
CREATE POLICY "Org admins can manage labor rules" ON public.labor_rules
  FOR ALL TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.locations l WHERE l.id = labor_rules.location_id
               AND (public.is_org_admin(auth.uid(), l.organization_id)
                    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_org_member(auth.uid(), l.organization_id))))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.locations l WHERE l.id = labor_rules.location_id
               AND (public.is_org_admin(auth.uid(), l.organization_id)
                    OR (public.has_role(auth.uid(), 'admin'::app_role) AND public.is_org_member(auth.uid(), l.organization_id))))
  );