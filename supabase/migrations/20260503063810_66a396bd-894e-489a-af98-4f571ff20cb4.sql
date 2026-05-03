CREATE TABLE public.inventory_order_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_row_id UUID NOT NULL,
  count_id UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL,
  assignment_mode TEXT NOT NULL DEFAULT 'manual',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT inventory_order_assignments_source_type_check CHECK (source_type IN ('pfg','pa','invoice')),
  CONSTRAINT inventory_order_assignments_period_type_check CHECK (period_type IN ('weekly','monthly','yearly')),
  CONSTRAINT inventory_order_assignments_assignment_mode_check CHECK (assignment_mode IN ('auto','manual')),
  CONSTRAINT inventory_order_assignments_unique_period UNIQUE (source_type, source_row_id, period_type)
);

ALTER TABLE public.inventory_order_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_inventory_order_assignments_count_id
  ON public.inventory_order_assignments(count_id);

CREATE INDEX idx_inventory_order_assignments_lookup
  ON public.inventory_order_assignments(location_id, period_type, source_type, source_row_id);

CREATE INDEX idx_inventory_order_assignments_source_lookup
  ON public.inventory_order_assignments(source_type, source_row_id);

CREATE TRIGGER update_inventory_order_assignments_updated_at
BEFORE UPDATE ON public.inventory_order_assignments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can view order assignments for accessible locations"
ON public.inventory_order_assignments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_assignments.location_id
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Users can create order assignments for accessible locations"
ON public.inventory_order_assignments
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_assignments.location_id
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Users can update order assignments for accessible locations"
ON public.inventory_order_assignments
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_assignments.location_id
  )
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_assignments.location_id
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Users can delete order assignments for accessible locations"
ON public.inventory_order_assignments
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_assignments.location_id
  )
  OR public.is_super_admin(auth.uid())
);

INSERT INTO public.inventory_order_assignments (
  source_type,
  source_row_id,
  count_id,
  location_id,
  period_type,
  assignment_mode
)
SELECT
  'pfg',
  p.id,
  c.id,
  p.location_id,
  c.period_type,
  'manual'
FROM public.pfg_orders p
JOIN public.inventory_counts c ON c.id = p.bound_to_count_id
WHERE p.bound_to_count_id IS NOT NULL
ON CONFLICT (source_type, source_row_id, period_type) DO NOTHING;

INSERT INTO public.inventory_order_assignments (
  source_type,
  source_row_id,
  count_id,
  location_id,
  period_type,
  assignment_mode
)
SELECT
  'pa',
  p.id,
  c.id,
  p.location_id,
  c.period_type,
  'manual'
FROM public.pa_orders p
JOIN public.inventory_counts c ON c.id = p.bound_to_count_id
WHERE p.bound_to_count_id IS NOT NULL
ON CONFLICT (source_type, source_row_id, period_type) DO NOTHING;

INSERT INTO public.inventory_order_assignments (
  source_type,
  source_row_id,
  count_id,
  location_id,
  period_type,
  assignment_mode
)
SELECT
  'invoice',
  v.id,
  c.id,
  v.location_id,
  c.period_type,
  'manual'
FROM public.vendor_invoices v
JOIN public.inventory_counts c ON c.id = v.inventory_count_id
WHERE v.inventory_count_id IS NOT NULL
ON CONFLICT (source_type, source_row_id, period_type) DO NOTHING;