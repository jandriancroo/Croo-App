CREATE OR REPLACE FUNCTION public.get_sales_ly_totals(_location_id uuid, _date date)
RETURNS TABLE(ly_day_total numeric, ly_week_total numeric, ly_month_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_ws date := _date - ((EXTRACT(ISODOW FROM _date)::int) - 1);
        v_lms date := (date_trunc('month', _date) - interval '1 year')::date;
BEGIN
  IF NOT public._sales_caller_ok(_location_id, 'shift_manager') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    (SELECT s.net_sales FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date=_date-364),
    (SELECT sum(s.net_sales) FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date BETWEEN v_ws-364 AND v_ws-358),
    (SELECT sum(s.net_sales) FROM sales_cache s WHERE s.location_id=_location_id AND s.sale_date BETWEEN v_lms AND (v_lms + interval '1 month' - interval '1 day')::date);
END $$;
GRANT EXECUTE ON FUNCTION public.get_sales_ly_totals(uuid, date) TO authenticated;