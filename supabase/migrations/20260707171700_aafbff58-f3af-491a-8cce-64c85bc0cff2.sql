
-- 1) Multi-day weekly schedule support
ALTER TABLE public.inventory_schedule_settings
  DROP CONSTRAINT IF EXISTS inventory_schedule_settings_location_id_frequency_key;

-- One monthly row per location
CREATE UNIQUE INDEX IF NOT EXISTS inventory_schedule_settings_monthly_unique
  ON public.inventory_schedule_settings (location_id)
  WHERE frequency = 'monthly';

-- Multiple weekly rows per location, one per day_of_week
CREATE UNIQUE INDEX IF NOT EXISTS inventory_schedule_settings_weekly_unique
  ON public.inventory_schedule_settings (location_id, day_of_week)
  WHERE frequency = 'weekly';

-- 2) Lite vendor order-day schedule
CREATE TABLE IF NOT EXISTS public.lite_vendor_order_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  order_day INTEGER NOT NULL CHECK (order_day BETWEEN 0 AND 6),
  delivery_day INTEGER CHECK (delivery_day BETWEEN 0 AND 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, vendor_name, order_day)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_vendor_order_schedule TO authenticated;
GRANT ALL ON public.lite_vendor_order_schedule TO service_role;

ALTER TABLE public.lite_vendor_order_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lite_vendor_order_schedule_select"
  ON public.lite_vendor_order_schedule FOR SELECT
  USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "lite_vendor_order_schedule_insert"
  ON public.lite_vendor_order_schedule FOR INSERT
  WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "lite_vendor_order_schedule_update"
  ON public.lite_vendor_order_schedule FOR UPDATE
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "lite_vendor_order_schedule_delete"
  ON public.lite_vendor_order_schedule FOR DELETE
  USING (public.has_location_access(auth.uid(), location_id));

CREATE TRIGGER update_lite_vendor_order_schedule_updated_at
  BEFORE UPDATE ON public.lite_vendor_order_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Historical count backfill flag
ALTER TABLE public.lite_inventory_counts
  ADD COLUMN IF NOT EXISTS is_backfill BOOLEAN NOT NULL DEFAULT false;
