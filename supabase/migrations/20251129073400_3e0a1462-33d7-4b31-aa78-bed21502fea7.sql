-- Function to increment/decrement Croo Cash balance
CREATE OR REPLACE FUNCTION public.increment_croo_cash(
  user_id UUID,
  amount INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET croo_cash_balance = croo_cash_balance + amount
  WHERE id = user_id;
END;
$$;