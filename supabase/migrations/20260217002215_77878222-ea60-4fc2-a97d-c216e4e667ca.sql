
-- Pizza category groups (e.g., "Large Pizza", "Regular Pizza", "Specialty")
CREATE TABLE public.inventory_product_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, name)
);

-- Usage rates: links an inventory item to a product group with an auto-calculated rate
CREATE TABLE public.inventory_usage_rates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  product_group_id UUID NOT NULL REFERENCES public.inventory_product_groups(id) ON DELETE CASCADE,
  usage_rate NUMERIC,
  rate_unit TEXT DEFAULT 'per_unit',
  calculated_from_period_start DATE,
  calculated_from_period_end DATE,
  last_calculated_at TIMESTAMPTZ,
  manual_override BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(inventory_item_id, product_group_id)
);

-- Enable RLS
ALTER TABLE public.inventory_product_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_usage_rates ENABLE ROW LEVEL SECURITY;

-- RLS policies for product groups
CREATE POLICY "Users can view product groups for their locations"
  ON public.inventory_product_groups FOR SELECT
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage product groups for their locations"
  ON public.inventory_product_groups FOR ALL
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

-- RLS policies for usage rates
CREATE POLICY "Users can view usage rates for their locations"
  ON public.inventory_usage_rates FOR SELECT
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage usage rates for their locations"
  ON public.inventory_usage_rates FOR ALL
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

-- Timestamp trigger
CREATE TRIGGER update_inventory_product_groups_updated_at
  BEFORE UPDATE ON public.inventory_product_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_usage_rates_updated_at
  BEFORE UPDATE ON public.inventory_usage_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
