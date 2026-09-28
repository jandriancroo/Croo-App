CREATE TABLE public.toast_employee_wages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  toast_user_id text NOT NULL,
  hourly_wage numeric(10,2) NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, toast_user_id)
);
GRANT ALL ON public.toast_employee_wages TO service_role;
ALTER TABLE public.toast_employee_wages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view toast wages" ON public.toast_employee_wages FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT ON public.toast_employee_wages TO authenticated;

-- Toast always wins: when a Toast employee gets paired (or their Toast rate changes),
-- stamp the Toast rate into the CrooHQ pay history effective today.
CREATE OR REPLACE FUNCTION public.toast_push_wage_to_profile(_location_id uuid, _toast_user_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _croo uuid; _wage numeric; _cur numeric; _today date;
BEGIN
  SELECT croo_user_id INTO _croo FROM toast_employee_mappings WHERE location_id=_location_id AND toast_user_id=_toast_user_id;
  SELECT hourly_wage INTO _wage FROM toast_employee_wages WHERE location_id=_location_id AND toast_user_id=_toast_user_id;
  IF _croo IS NULL OR _wage IS NULL THEN RETURN; END IF;
  _today := (now() AT TIME ZONE COALESCE((SELECT timezone FROM location_settings WHERE location_id=_location_id), 'America/Chicago'))::date;
  SELECT hourly_wage INTO _cur FROM wage_history WHERE user_id=_croo AND effective_date<=_today ORDER BY effective_date DESC LIMIT 1;
  IF _cur IS DISTINCT FROM _wage THEN
    INSERT INTO wage_history(user_id, hourly_wage, effective_date, notes)
    VALUES (_croo, _wage, _today, 'From Toast')
    ON CONFLICT (user_id, effective_date) DO UPDATE SET hourly_wage=EXCLUDED.hourly_wage, notes='From Toast';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.toast_push_wage_to_profile(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_toast_wage_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.toast_push_wage_to_profile(NEW.location_id, NEW.toast_user_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_toast_wage_sync() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER toast_wage_on_pair AFTER INSERT OR UPDATE OF croo_user_id ON public.toast_employee_mappings
  FOR EACH ROW WHEN (NEW.croo_user_id IS NOT NULL) EXECUTE FUNCTION public.trg_toast_wage_sync();
CREATE TRIGGER toast_wage_on_change AFTER INSERT OR UPDATE OF hourly_wage ON public.toast_employee_wages
  FOR EACH ROW EXECUTE FUNCTION public.trg_toast_wage_sync();