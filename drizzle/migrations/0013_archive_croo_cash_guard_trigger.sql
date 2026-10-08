CREATE OR REPLACE FUNCTION public.guard_archived_croo_cash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('anon','authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.croo_cash_balance := 0;
    ELSIF NEW.croo_cash_balance IS DISTINCT FROM OLD.croo_cash_balance THEN
      NEW.croo_cash_balance := OLD.croo_cash_balance;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.guard_archived_croo_cash() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_archived_croo_cash
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_archived_croo_cash();
COMMENT ON FUNCTION public.guard_archived_croo_cash() IS 'Keeps archived profiles.croo_cash_balance unchanged by client roles (anon/authenticated).';
COMMENT ON TABLE public.croo_cash_transactions IS 'ARCHIVED 2026-10-07: Croo Cash retired. See docs/archive/croo-cash.md. Do not use.';
COMMENT ON COLUMN public.profiles.croo_cash_balance IS 'ARCHIVED 2026-10-07: Croo Cash retired. See docs/archive/croo-cash.md. Do not use.';
COMMENT ON FUNCTION public.increment_croo_cash(uuid, integer) IS 'ARCHIVED 2026-10-07: Croo Cash retired. See docs/archive/croo-cash.md. Do not use.';