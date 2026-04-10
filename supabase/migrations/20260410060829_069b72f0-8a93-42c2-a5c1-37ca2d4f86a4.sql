
ALTER TABLE public.menu_price_overrides 
  ADD COLUMN tpd_upcharge_pct numeric DEFAULT NULL,
  ADD COLUMN tpd_fee_pct numeric DEFAULT NULL;
