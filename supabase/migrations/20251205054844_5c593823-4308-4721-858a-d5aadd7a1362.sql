-- Create catering_orders table
CREATE TABLE public.catering_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id),
  order_number TEXT,
  customer_name TEXT NOT NULL,
  pickup_date DATE NOT NULL,
  pickup_time TIME NOT NULL,
  headcount INTEGER,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES public.profiles(id),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catering_orders ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view catering orders at their locations"
ON public.catering_orders FOR SELECT
USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can create catering orders at their locations"
ON public.catering_orders FOR INSERT
WITH CHECK (auth.uid() = created_by AND has_location_access(auth.uid(), location_id));

CREATE POLICY "Shift managers and above can update catering orders"
ON public.catering_orders FOR UPDATE
USING (
  has_location_access(auth.uid(), location_id) AND (
    has_role(auth.uid(), 'shift_manager'::app_role) OR
    has_role(auth.uid(), 'general_manager'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  )
);

CREATE POLICY "Admins can delete catering orders"
ON public.catering_orders FOR DELETE
USING (
  has_location_access(auth.uid(), location_id) AND
  has_role(auth.uid(), 'admin'::app_role)
);

-- Index for querying by date
CREATE INDEX idx_catering_orders_pickup_date ON public.catering_orders(pickup_date);
CREATE INDEX idx_catering_orders_location_id ON public.catering_orders(location_id);