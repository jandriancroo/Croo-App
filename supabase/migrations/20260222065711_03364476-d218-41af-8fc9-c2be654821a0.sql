-- Add counted_at timestamp to inventory_counts for precise sales cutoff
ALTER TABLE public.inventory_counts 
ADD COLUMN counted_at timestamptz;

-- Create delivery reconciliation table
CREATE TABLE public.inventory_count_deliveries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_id uuid NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  order_type text NOT NULL CHECK (order_type IN ('pfg', 'produce_alliance')),
  order_id uuid NOT NULL,
  reconciled boolean NOT NULL DEFAULT true,
  reconciled_by uuid REFERENCES auth.users(id),
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: each delivery can only be linked to one count
CREATE UNIQUE INDEX idx_count_deliveries_unique_order 
ON public.inventory_count_deliveries (order_type, order_id);

-- Index for fast lookups by count
CREATE INDEX idx_count_deliveries_count_id 
ON public.inventory_count_deliveries (count_id);

-- Enable RLS
ALTER TABLE public.inventory_count_deliveries ENABLE ROW LEVEL SECURITY;

-- RLS policies using location access via the parent count
CREATE POLICY "Users can view delivery reconciliation for their locations"
ON public.inventory_count_deliveries
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_counts ic
    WHERE ic.id = count_id
    AND public.has_location_access(auth.uid(), ic.location_id)
  )
);

CREATE POLICY "Users can insert delivery reconciliation for their locations"
ON public.inventory_count_deliveries
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.inventory_counts ic
    WHERE ic.id = count_id
    AND public.has_location_access(auth.uid(), ic.location_id)
  )
);

CREATE POLICY "Users can update delivery reconciliation for their locations"
ON public.inventory_count_deliveries
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_counts ic
    WHERE ic.id = count_id
    AND public.has_location_access(auth.uid(), ic.location_id)
  )
);

CREATE POLICY "Users can delete delivery reconciliation for their locations"
ON public.inventory_count_deliveries
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_counts ic
    WHERE ic.id = count_id
    AND public.has_location_access(auth.uid(), ic.location_id)
  )
);