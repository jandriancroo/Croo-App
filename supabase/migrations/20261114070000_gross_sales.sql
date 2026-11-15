-- Gross sales (visibility only). Net stays the primary metric for goals, pace, labor % and projections.
-- gross = net + discounts + comps + promos + refunds; tax, tips, service charges and voids excluded.
-- gross_basis: 'pos' = the sales system's own gross figure; 'rebuilt' = net plus that feed's own concession fields.
-- A day missing any piece its feed reports keeps gross_sales NULL (screens hide it; never gross = net).
-- Rollback: DROP FUNCTION get_gross_sales_periods(uuid,date), get_gross_sales_range(uuid,date,date), _sales_gross_rebuild(...);
--           restore guard_pos_sales_extras from 0084; ALTER TABLE sales_cache DROP COLUMN gross_sales, refund_amount, gross_basis.

ALTER TABLE public.sales_cache
 ADD COLUMN IF NOT EXISTS gross_sales numeric,
 ADD COLUMN IF NOT EXISTS refund_amount numeric,
 ADD COLUMN IF NOT EXISTS gross_basis text CHECK (gross_basis IN ('pos','rebuilt'));

COMMENT ON COLUMN public.sales_cache.gross_sales IS 'Visibility only. Net + discounts + comps + promos + refunds, before tax/tips. NULL when a piece is missing. Never a goal, pace or labor input.';
COMMENT ON COLUMN public.sales_cache.refund_amount IS 'Refunds (item portion, positive number) when the feed reports them.';
COMMENT ON COLUMN public.sales_cache.gross_basis IS 'pos = sales system gross figure; rebuilt = net + this feed''s own discount/comp/promo/refund fields.';

-- Which pieces each feed must have measured before gross can be rebuilt.
CREATE OR REPLACE FUNCTION public._sales_gross_rebuild(_pos_source text, _net numeric, _discount numeric, _comp numeric, _promo numeric, _refund numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
 SELECT CASE
  WHEN _net IS NULL THEN NULL
  -- Toast: only its official gross (sent with gross_basis 'pos'); never rebuilt from the discounts list.
  -- Clover: comps live inside discounts; refunds are reported separately.
  WHEN _pos_source = 'clover' AND _discount IS NOT NULL AND _refund IS NOT NULL
   THEN _net + abs(_discount) + abs(_refund) + coalesce(abs(_comp),0) + coalesce(abs(_promo),0)
  -- Blaze feed: comps and promos are inside its discount total.
  WHEN _pos_source = 'qubeyond' AND _discount IS NOT NULL
   THEN _net + abs(_discount) + coalesce(abs(_refund),0) + coalesce(abs(_comp),0) + coalesce(abs(_promo),0)
  -- Aloha grid: promos and comps (no separate discount column); voids never sold, stay out.
  WHEN _pos_source = 'aloha' AND _comp IS NOT NULL AND _promo IS NOT NULL
   THEN _net + abs(_comp) + abs(_promo) + coalesce(abs(_discount),0) + coalesce(abs(_refund),0)
  ELSE NULL
 END
$$;
REVOKE ALL ON FUNCTION public._sales_gross_rebuild(text,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;

-- Same guard as 0084 (unknown/zero never wipes a measured value), plus refunds and gross.
CREATE OR REPLACE FUNCTION public.guard_pos_sales_extras() RETURNS trigger LANGUAGE plpgsql SET search_path='public' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.discount_amount IS NULL OR (NEW.discount_amount=0 AND OLD.discount_amount<>0) THEN NEW.discount_amount:=OLD.discount_amount; END IF;
  IF NEW.comp_amount IS NULL OR (NEW.comp_amount=0 AND OLD.comp_amount<>0) THEN NEW.comp_amount:=OLD.comp_amount; END IF;
  IF NEW.comp_count IS NULL OR (NEW.comp_count=0 AND OLD.comp_count<>0) THEN NEW.comp_count:=OLD.comp_count; END IF;
  IF NEW.void_amount IS NULL OR (NEW.void_amount=0 AND OLD.void_amount<>0) THEN NEW.void_amount:=OLD.void_amount; END IF;
  IF NEW.void_count IS NULL OR (NEW.void_count=0 AND OLD.void_count<>0) THEN NEW.void_count:=OLD.void_count; END IF;
  IF NEW.promo_amount IS NULL OR (NEW.promo_amount=0 AND OLD.promo_amount<>0) THEN NEW.promo_amount:=OLD.promo_amount; END IF;
  IF NEW.promo_count IS NULL OR (NEW.promo_count=0 AND OLD.promo_count<>0) THEN NEW.promo_count:=OLD.promo_count; END IF;
  IF NEW.check_count IS NULL OR (NEW.check_count=0 AND OLD.check_count<>0) THEN NEW.check_count:=OLD.check_count; END IF;
  IF NEW.tips_amount IS NULL OR (NEW.tips_amount=0 AND OLD.tips_amount<>0) THEN NEW.tips_amount:=OLD.tips_amount; END IF;
  IF NEW.refund_amount IS NULL OR (NEW.refund_amount=0 AND OLD.refund_amount<>0) THEN NEW.refund_amount:=OLD.refund_amount; END IF;
 END IF;
 -- POS gross figure: kept as sent. Otherwise rebuild from this row's own measured pieces.
 IF NEW.gross_basis = 'pos' AND NEW.gross_sales IS NOT NULL THEN
  RETURN NEW;
 END IF;
 NEW.gross_sales := public._sales_gross_rebuild(NEW.pos_source, NEW.net_sales, NEW.discount_amount, NEW.comp_amount, NEW.promo_amount, NEW.refund_amount);
 NEW.gross_basis := CASE WHEN NEW.gross_sales IS NULL THEN NULL ELSE 'rebuilt' END;
 RETURN NEW;
END $$;

-- Toast: official gross is already in every stored raw day (netSales[0]); no re-pull needed.
-- Also replaces the discount-list sum with the official discount total.
UPDATE public.sales_cache s SET
  gross_sales = (t.raw_payload->'netSales'->0->>'grossSales')::numeric,
  gross_basis = 'pos',
  discount_amount = abs((t.raw_payload->'netSales'->0->>'discountAmount')::numeric),
  refund_amount = abs(coalesce((t.raw_payload->'netSales'->0->>'refundAmount')::numeric, 0))
FROM public.toast_sales_cache t
WHERE t.location_id = s.location_id AND t.sale_date = s.sale_date
  AND s.pos_source = 'toast'
  AND jsonb_typeof(t.raw_payload->'netSales') = 'array'
  AND (t.raw_payload->'netSales'->0->>'grossSales') IS NOT NULL;

-- Every other row: rebuild from pieces already stored (trigger fills gross_sales / gross_basis).
UPDATE public.sales_cache SET refund_amount = refund_amount
WHERE gross_basis IS NULL AND (discount_amount IS NOT NULL OR comp_amount IS NOT NULL OR promo_amount IS NOT NULL);

-- Period totals for the dashboard (same week/month/LY rules as get_sales_comparisons / get_sales_ly_totals).
-- A period is NULL unless every day that has sales in it also has gross.
CREATE OR REPLACE FUNCTION public._gross_sum(_location_id uuid, _from date, _to date)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
 SELECT CASE WHEN count(*) FILTER (WHERE coalesce(s.net_sales,0) > 0) = 0 THEN NULL
             WHEN bool_and(s.gross_sales IS NOT NULL) FILTER (WHERE coalesce(s.net_sales,0) > 0) THEN sum(s.gross_sales) FILTER (WHERE coalesce(s.net_sales,0) > 0)
             ELSE NULL END
 FROM public.sales_cache s
 WHERE s.location_id = _location_id AND s.sale_date BETWEEN _from AND _to
$$;
REVOKE ALL ON FUNCTION public._gross_sum(uuid,date,date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_gross_sales_periods(_location_id uuid, _date date)
RETURNS TABLE(day_gross numeric, yday_gross numeric, wtd_gross numeric, mtd_gross numeric, lw_day_gross numeric, lw_wtd_gross numeric, lm_mtd_gross numeric,
              ly_date date, ly_day_gross numeric, ly_week_gross numeric, ly_month_gross numeric, days jsonb, day_hourly jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ws date := _date - ((EXTRACT(ISODOW FROM _date)::int) - 1);
        v_ms date := date_trunc('month', _date)::date;
        v_lms date := (date_trunc('month', _date) - interval '1 year')::date;
        v_pms date := (date_trunc('month', _date) - interval '1 month')::date;
BEGIN
  IF NOT public._sales_caller_ok(_location_id, 'shift_manager') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    public._gross_sum(_location_id, _date, _date),
    public._gross_sum(_location_id, _date - 1, _date - 1),
    public._gross_sum(_location_id, v_ws, _date),
    public._gross_sum(_location_id, v_ms, _date),
    public._gross_sum(_location_id, _date - 7, _date - 7),
    public._gross_sum(_location_id, v_ws - 7, _date - 7),
    public._gross_sum(_location_id, v_pms, LEAST((v_pms + interval '1 month' - interval '1 day')::date, (_date - interval '1 month')::date)),
    _date - 364,
    public._gross_sum(_location_id, _date - 364, _date - 364),
    public._gross_sum(_location_id, v_ws - 364, v_ws - 358),
    public._gross_sum(_location_id, v_lms, (v_lms + interval '1 month' - interval '1 day')::date),
    -- Per-day gross for the week and month around _date (chart hover pills).
    (SELECT coalesce(jsonb_object_agg(s.sale_date::text, s.gross_sales), '{}'::jsonb)
       FROM public.sales_cache s
      WHERE s.location_id = _location_id AND s.gross_sales IS NOT NULL
        AND s.sale_date BETWEEN LEAST(v_ws, v_ms) AND GREATEST(v_ws + 6, (v_ms + interval '1 month' - interval '1 day')::date)),
    -- Per-hour gross for _date, only hours whose pieces were reported.
    (SELECT coalesce(jsonb_object_agg(e->>'hour', (e->>'gross')::numeric), '{}'::jsonb)
       FROM public.sales_cache s, jsonb_array_elements(CASE WHEN jsonb_typeof(s.hourly_data) = 'array' THEN s.hourly_data ELSE '[]'::jsonb END) e
      WHERE s.location_id = _location_id AND s.sale_date = _date AND e ? 'gross' AND jsonb_typeof(e->'gross') = 'number');
END $$;
REVOKE ALL ON FUNCTION public.get_gross_sales_periods(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gross_sales_periods(uuid,date) TO authenticated;

-- Any custom range (reports): total plus coverage counts so screens can hide partial gross.
CREATE OR REPLACE FUNCTION public.get_gross_sales_range(_location_id uuid, _start date, _end date)
RETURNS TABLE(gross_sales numeric, sales_days integer, gross_days integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._sales_caller_ok(_location_id, 'shift_manager') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF _end < _start OR _end - _start > 400 THEN RAISE EXCEPTION 'bad range' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT public._gross_sum(_location_id, _start, _end),
    (count(*) FILTER (WHERE coalesce(s.net_sales,0) > 0))::int,
    (count(*) FILTER (WHERE coalesce(s.net_sales,0) > 0 AND s.gross_sales IS NOT NULL))::int
  FROM public.sales_cache s WHERE s.location_id = _location_id AND s.sale_date BETWEEN _start AND _end;
END $$;
REVOKE ALL ON FUNCTION public.get_gross_sales_range(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gross_sales_range(uuid,date,date) TO authenticated;

INSERT INTO public.data_point_registry (key,label,category,unit,description,canonical_table,canonical_column,sources,refresh_cadence,readers,sot_status,sot_ref,notes) VALUES
('gross_sales','Gross sales','sales','usd','Daily gross sales (net + discounts + comps + promos + refunds, before tax and tips). Visibility only, never a goal/pace/labor input.','sales_cache','gross_sales',
 '{"toast":{"writer":"toast-sync","basis":"pos","notes":"official netSales[0].grossSales from the runner payload; history from toast_sales_cache.raw_payload"},
   "clover":{"writer":"clover-sync","basis":"pos","notes":"revenue item sales before discounts/refunds, computed from orders in the sync; history via backfill_gross"},
   "qubeyond":{"writer":"sales-service / fetch-qubeyond-sales","basis":"rebuilt","notes":"net + hourly discount total (comps/promos are inside it); history via sales-service backfill-gross"},
   "aloha":{"writer":"aloha-sync","basis":"rebuilt","notes":"net + comps + promos from the grid; voids excluded; history via backfill_gross"}}'::jsonb,
 'with each POS sync', ARRAY['DataCube gross metrics','Sales Summary gross toggle','Reports Gross Sales Total'],'single','guard_pos_sales_extras / _sales_gross_rebuild',
 'Missing piece = NULL; screens hide gross for that day/period.')
ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, sources=EXCLUDED.sources, readers=EXCLUDED.readers, notes=EXCLUDED.notes, updated_at=now();
