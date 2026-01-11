-- 1) Allow admins/managers to create shift offers (RLS fix)
-- Existing policy only allows users to offer their own shift.
-- This policy allows higher roles to create an offer, but still requires that the offer is attributed to the shift owner.

CREATE POLICY "Admins/managers can offer shifts"
ON public.shift_offers
FOR INSERT
WITH CHECK (
  (
    public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'org_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'brand_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  AND EXISTS (
    SELECT 1
    FROM public.scheduled_shifts ss
    WHERE ss.id = shift_offers.shift_id
      AND ss.user_id = shift_offers.offered_by_user_id
  )
);


-- 2) Prevent duplicate Drawer Count entries per location+date (data integrity)
-- We cannot use a CHECK constraint for this; use a trigger.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_drawer_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cat_name text;
BEGIN
  -- Only enforce for entries tied to an actual location
  IF NEW.location_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(name) INTO v_cat_name
  FROM public.logbook_categories
  WHERE id = NEW.category_id;

  IF v_cat_name = 'drawer count' THEN
    IF EXISTS (
      SELECT 1
      FROM public.logbook_entries le
      WHERE le.location_id = NEW.location_id
        AND le.category_id = NEW.category_id
        AND le.entry_date = NEW.entry_date
        AND le.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      LIMIT 1
    ) THEN
      RAISE EXCEPTION 'A Drawer Count already exists for % at this location', NEW.entry_date
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_drawer_counts ON public.logbook_entries;

CREATE TRIGGER trg_prevent_duplicate_drawer_counts
BEFORE INSERT OR UPDATE ON public.logbook_entries
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_drawer_counts();
