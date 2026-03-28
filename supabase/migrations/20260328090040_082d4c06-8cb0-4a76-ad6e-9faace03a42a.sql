
-- Inventory Transfers table
CREATE TABLE public.inventory_transfers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_location_id UUID NOT NULL REFERENCES public.locations(id),
  to_location_id UUID NOT NULL REFERENCES public.locations(id),
  transferred_by UUID NOT NULL REFERENCES public.profiles(id),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  period_end_date DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'cancelled')),
  received_by UUID REFERENCES public.profiles(id),
  received_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transfer line items
CREATE TABLE public.inventory_transfer_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES public.inventory_transfers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id),
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_type TEXT NOT NULL DEFAULT 'unit' CHECK (unit_type IN ('unit', 'case')),
  cost_per_unit NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer_items ENABLE ROW LEVEL SECURITY;

-- RLS: Users can see transfers involving their locations
CREATE POLICY "Users can view transfers for their locations"
  ON public.inventory_transfers FOR SELECT TO authenticated
  USING (
    public.has_location_access(auth.uid(), from_location_id)
    OR public.has_location_access(auth.uid(), to_location_id)
  );

CREATE POLICY "Users can create transfers from their locations"
  ON public.inventory_transfers FOR INSERT TO authenticated
  WITH CHECK (
    public.has_location_access(auth.uid(), from_location_id)
    AND public.has_role_or_higher(auth.uid(), 'shift_manager')
  );

CREATE POLICY "Users can update transfers for their locations"
  ON public.inventory_transfers FOR UPDATE TO authenticated
  USING (
    public.has_location_access(auth.uid(), from_location_id)
    OR public.has_location_access(auth.uid(), to_location_id)
  );

-- Transfer items: access via parent transfer
CREATE POLICY "Users can view transfer items"
  ON public.inventory_transfer_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_transfers t
      WHERE t.id = transfer_id
      AND (public.has_location_access(auth.uid(), t.from_location_id)
           OR public.has_location_access(auth.uid(), t.to_location_id))
    )
  );

CREATE POLICY "Users can insert transfer items"
  ON public.inventory_transfer_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventory_transfers t
      WHERE t.id = transfer_id
      AND public.has_location_access(auth.uid(), t.from_location_id)
    )
  );

CREATE POLICY "Users can update transfer items"
  ON public.inventory_transfer_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_transfers t
      WHERE t.id = transfer_id
      AND public.has_location_access(auth.uid(), t.from_location_id)
    )
  );
