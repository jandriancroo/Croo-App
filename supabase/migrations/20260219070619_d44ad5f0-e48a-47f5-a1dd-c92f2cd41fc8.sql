-- Create pa_orders table to persist Produce Alliance order history (mirrors pfg_orders structure)
CREATE TABLE public.pa_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id),
  pa_order_id TEXT NOT NULL,
  order_number TEXT,
  order_date DATE NOT NULL,
  delivery_date DATE,
  status TEXT,
  total_amount NUMERIC,
  items JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, pa_order_id)
);

-- Enable RLS
ALTER TABLE public.pa_orders ENABLE ROW LEVEL SECURITY;

-- RLS policies matching pfg_orders pattern
CREATE POLICY "Users can view PA orders at their location"
ON public.pa_orders FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can insert PA orders at their location"
ON public.pa_orders FOR INSERT
WITH CHECK (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update PA orders at their location"
ON public.pa_orders FOR UPDATE
USING (has_location_access(auth.uid(), location_id));

-- Index for period-based queries (COGS report)
CREATE INDEX idx_pa_orders_location_date ON public.pa_orders (location_id, order_date);

-- Timestamp trigger
CREATE TRIGGER update_pa_orders_updated_at
BEFORE UPDATE ON public.pa_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();