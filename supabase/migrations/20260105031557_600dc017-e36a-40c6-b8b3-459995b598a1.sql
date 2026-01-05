-- Create table for PFG orders
CREATE TABLE public.pfg_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  pfg_order_id TEXT NOT NULL,
  order_number TEXT,
  order_date DATE NOT NULL,
  delivery_date DATE,
  status TEXT,
  total_amount NUMERIC(10,2),
  items JSONB DEFAULT '[]'::jsonb,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(location_id, pfg_order_id)
);

-- Enable RLS
ALTER TABLE public.pfg_orders ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view orders at their location
CREATE POLICY "Users can view orders at their location" 
ON public.pfg_orders 
FOR SELECT 
USING (
  location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  )
);

-- Create policy for service role to manage orders (for edge function)
CREATE POLICY "Service role can manage all orders"
ON public.pfg_orders
FOR ALL
USING (true)
WITH CHECK (true);

-- Add index for faster lookups
CREATE INDEX idx_pfg_orders_location_date ON public.pfg_orders(location_id, order_date DESC);
CREATE INDEX idx_pfg_orders_delivery_date ON public.pfg_orders(location_id, delivery_date);

-- Add trigger for updated_at
CREATE TRIGGER update_pfg_orders_updated_at
BEFORE UPDATE ON public.pfg_orders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();