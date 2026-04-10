
-- Create kds_orders table for shared KDS state
CREATE TABLE public.kds_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id TEXT NOT NULL,
  check_number TEXT NOT NULL,
  customer_name TEXT,
  order_type TEXT,
  channel TEXT,
  employee TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  gross_sales NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ready', 'cleared')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bumped_at TIMESTAMPTZ,
  cleared_at TIMESTAMPTZ,
  bumped_by UUID REFERENCES auth.users(id),
  cleared_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, check_number)
);

-- Enable RLS
ALTER TABLE public.kds_orders ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can read, insert, update
CREATE POLICY "Authenticated users can view kds_orders"
  ON public.kds_orders FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert kds_orders"
  ON public.kds_orders FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update kds_orders"
  ON public.kds_orders FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- Service role needs insert/update for edge function syncing
CREATE POLICY "Service role full access"
  ON public.kds_orders FOR ALL
  USING (true) WITH CHECK (true);

-- Auto-update timestamp
CREATE TRIGGER update_kds_orders_updated_at
  BEFORE UPDATE ON public.kds_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast lookups
CREATE INDEX idx_kds_orders_store_status ON public.kds_orders (store_id, status);
CREATE INDEX idx_kds_orders_opened_at ON public.kds_orders (opened_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.kds_orders;
