-- Rollback: restore guard_sales_cache_goals from 0077_daily_goal_consistency_security.sql (remove only the Planning goal is locked block).
-- Step C writer audit: POS syncs omit goal columns; only goalEngine writes Planning with NULL-only updates.
CREATE OR REPLACE FUNCTION public.guard_sales_cache_goals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_claims text := NULLIF(current_setting('request.jwt.claims', true), '');
  v_role text := COALESCE(v_claims::jsonb->>'role', '');
  v_uid uuid := auth.uid();
  v_service boolean := v_claims IS NULL OR v_role = 'service_role';
  v_sys boolean; v_ovr boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_sys := NEW.initial_projection IS NOT NULL OR NEW.living_projection IS NOT NULL OR NEW.projected_sales IS NOT NULL;
    v_ovr := NEW.override_projection IS NOT NULL OR NEW.override_at IS NOT NULL OR NEW.override_by IS NOT NULL
             OR COALESCE(NEW.override_excluded_dates, '[]'::jsonb) <> '[]'::jsonb;
  ELSE
    v_sys := NEW.initial_projection IS DISTINCT FROM OLD.initial_projection
          OR NEW.living_projection IS DISTINCT FROM OLD.living_projection
          OR NEW.projected_sales IS DISTINCT FROM OLD.projected_sales;
    v_ovr := NEW.override_projection IS DISTINCT FROM OLD.override_projection
          OR NEW.override_at IS DISTINCT FROM OLD.override_at
          OR NEW.override_by IS DISTINCT FROM OLD.override_by
          OR NEW.override_excluded_dates IS DISTINCT FROM OLD.override_excluded_dates;
  END IF;
  IF NOT v_service THEN
    IF v_sys THEN
      RAISE EXCEPTION 'Planning/Living goals are system-managed' USING ERRCODE = '42501';
    END IF;
    IF v_ovr THEN
      IF NOT public._can_override_goal(v_uid) THEN
        RAISE EXCEPTION 'Only managers and above can change the daily goal' USING ERRCODE = '42501';
      END IF;
      IF NEW.sale_date < public.business_date(NEW.location_id) THEN
        RAISE EXCEPTION 'Past days are locked' USING ERRCODE = '42501';
      END IF;
      NEW.override_by := CASE WHEN NEW.override_projection IS NULL THEN NULL ELSE v_uid END;
      NEW.override_at := CASE WHEN NEW.override_projection IS NULL THEN NULL ELSE now() END;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.initial_projection IS NOT NULL
     AND NEW.initial_projection IS DISTINCT FROM OLD.initial_projection
     AND COALESCE(current_setting('croo.goal_backfill', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Planning goal is locked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;