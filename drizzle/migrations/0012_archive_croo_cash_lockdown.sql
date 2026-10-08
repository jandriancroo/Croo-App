REVOKE ALL ON public.croo_cash_transactions FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_croo_cash(uuid, integer) FROM anon, authenticated, PUBLIC;
-- profiles SELECT is column-level: remove read of the archived column.
REVOKE SELECT (croo_cash_balance) ON public.profiles FROM anon, authenticated;
REVOKE INSERT (croo_cash_balance), UPDATE (croo_cash_balance) ON public.profiles FROM anon, authenticated;
-- INSERT/UPDATE on profiles are table-level for authenticated, so a column revoke cannot block writes.
-- Guard trigger: client roles may not set or change the archived column.
CREATE OR REPLACE FUNCTION public.guard_archived_croo_cash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('anon','authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.croo_cash_balance := DEFAULT_PLACEHOLDER;
    END IF;
  END IF;
  RETURN NEW;
END $$;
