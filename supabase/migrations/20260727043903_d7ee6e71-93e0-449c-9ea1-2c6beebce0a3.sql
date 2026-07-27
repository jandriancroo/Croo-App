
-- ============================================================
-- Genius Order Coach — usage forecasting foundation
-- ============================================================

-- 1. Extend lite_inventory_items with forecasting configuration
ALTER TABLE public.lite_inventory_items
  ADD COLUMN IF NOT EXISTS usage_model text NOT NULL DEFAULT 'sales_linked'
    CHECK (usage_model IN ('sales_linked','time_based','par_based')),
  ADD COLUMN IF NOT EXISTS usage_model_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS units_per_case numeric(12,4),
  ADD COLUMN IF NOT EXISTS order_unit text,
  ADD COLUMN IF NOT EXISTS rounding_policy text NOT NULL DEFAULT 'up'
    CHECK (rounding_policy IN ('up','down','nearest')),
  ADD COLUMN IF NOT EXISTS par_level numeric(12,4),
  ADD COLUMN IF NOT EXISTS lead_time_days integer,
  ADD COLUMN IF NOT EXISTS delivery_dows integer[];

-- ============================================================
-- 2. item_usage_periods
-- ============================================================
CREATE TABLE IF NOT EXISTS public.item_usage_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.lite_inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  period_start_date date NOT NULL,
  period_end_date date NOT NULL,
  days_in_period integer NOT NULL,
  qty_start numeric(14,4) NOT NULL,
  qty_received numeric(14,4) NOT NULL DEFAULT 0,
  qty_end numeric(14,4) NOT NULL,
  usage numeric(14,4) NOT NULL,
  net_sales numeric(14,2),
  usage_per_dollar numeric(16,8),
  receipt_date_source text CHECK (receipt_date_source IN ('physical','invoice','mixed')),
  is_excluded boolean NOT NULL DEFAULT false,
  exclusion_reason text CHECK (exclusion_reason IN
    ('stockout','holiday','promo','bad_count','missing_count','catering','manual')),
  excluded_by uuid,
  excluded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, period_end_date)
);

CREATE INDEX IF NOT EXISTS item_usage_periods_item_idx
  ON public.item_usage_periods (item_id, period_end_date DESC);
CREATE INDEX IF NOT EXISTS item_usage_periods_location_idx
  ON public.item_usage_periods (location_id, period_end_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_usage_periods TO authenticated;
GRANT ALL ON public.item_usage_periods TO service_role;

ALTER TABLE public.item_usage_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_usage_periods_select" ON public.item_usage_periods
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "item_usage_periods_insert" ON public.item_usage_periods
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "item_usage_periods_update" ON public.item_usage_periods
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "item_usage_periods_delete" ON public.item_usage_periods
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE TRIGGER item_usage_periods_updated_at
  BEFORE UPDATE ON public.item_usage_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. dow_sales_profile
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dow_sales_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  avg_net_sales numeric(14,2) NOT NULL,
  share_of_week numeric(6,4) NOT NULL,
  weeks_in_sample integer NOT NULL,
  min_net_sales numeric(14,2),
  max_net_sales numeric(14,2),
  stddev numeric(14,2),
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, day_of_week)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dow_sales_profile TO authenticated;
GRANT ALL ON public.dow_sales_profile TO service_role;

ALTER TABLE public.dow_sales_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dow_sales_profile_select" ON public.dow_sales_profile
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "dow_sales_profile_insert" ON public.dow_sales_profile
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "dow_sales_profile_update" ON public.dow_sales_profile
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "dow_sales_profile_delete" ON public.dow_sales_profile
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

-- ============================================================
-- 4. item_usage_rates (one row per item — current fitted state)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.item_usage_rates (
  item_id uuid PRIMARY KEY REFERENCES public.lite_inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  weekly_usage_level numeric(14,4),
  alpha numeric(4,3) NOT NULL DEFAULT 0.350,
  residual_stddev numeric(14,4),
  r2_usage_vs_sales numeric(5,4),
  periods_used integer NOT NULL DEFAULT 0,
  last_fitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_usage_rates_location_idx
  ON public.item_usage_rates (location_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_usage_rates TO authenticated;
GRANT ALL ON public.item_usage_rates TO service_role;

ALTER TABLE public.item_usage_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_usage_rates_select" ON public.item_usage_rates
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "item_usage_rates_insert" ON public.item_usage_rates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "item_usage_rates_update" ON public.item_usage_rates
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "item_usage_rates_delete" ON public.item_usage_rates
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE TRIGGER item_usage_rates_updated_at
  BEFORE UPDATE ON public.item_usage_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. order_recommendations (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.order_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.lite_inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now(),
  as_of_date date NOT NULL,
  coverage_start date NOT NULL,
  coverage_end date NOT NULL,
  forecast_qty numeric(14,4) NOT NULL,
  projected_on_hand numeric(14,4),
  safety_stock numeric(14,4),
  recommended_qty numeric(14,4) NOT NULL,
  recommended_cases numeric(14,4),
  level_used numeric(14,4),
  shape_source text CHECK (shape_source IN
    ('sales_linked_dow','daily_projection','manager_override','time_based','par_based')),
  trend_factor numeric(6,4),
  actual_ordered_qty numeric(14,4),
  actual_usage_qty numeric(14,4),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_recommendations_item_idx
  ON public.order_recommendations (item_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS order_recommendations_location_idx
  ON public.order_recommendations (location_id, generated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_recommendations TO authenticated;
GRANT ALL ON public.order_recommendations TO service_role;

ALTER TABLE public.order_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_recommendations_select" ON public.order_recommendations
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "order_recommendations_insert" ON public.order_recommendations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "order_recommendations_update" ON public.order_recommendations
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY "order_recommendations_delete" ON public.order_recommendations
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
