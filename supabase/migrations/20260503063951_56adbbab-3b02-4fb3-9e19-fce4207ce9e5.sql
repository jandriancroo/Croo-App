CREATE TABLE public.inventory_order_exclusions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_row_id UUID NOT NULL,
  count_id UUID NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT inventory_order_exclusions_source_type_check CHECK (source_type IN ('pfg','pa','invoice')),
  CONSTRAINT inventory_order_exclusions_period_type_check CHECK (period_type IN ('weekly','monthly','yearly')),
  CONSTRAINT inventory_order_exclusions_unique_count UNIQUE (source_type, source_row_id, count_id, period_type)
);

ALTER TABLE public.inventory_order_exclusions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_inventory_order_exclusions_count_id
  ON public.inventory_order_exclusions(count_id);

CREATE INDEX idx_inventory_order_exclusions_lookup
  ON public.inventory_order_exclusions(location_id, period_type, source_type, source_row_id);

CREATE TRIGGER update_inventory_order_exclusions_updated_at
BEFORE UPDATE ON public.inventory_order_exclusions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can view order exclusions for accessible locations"
ON public.inventory_order_exclusions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_exclusions.location_id
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Users can create order exclusions for accessible locations"
ON public.inventory_order_exclusions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_exclusions.location_id
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Users can update order exclusions for accessible locations"
ON public.inventory_order_exclusions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_exclusions.location_id
  )
  OR public.is_super_admin(auth.uid())
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_exclusions.location_id
  )
  OR public.is_super_admin(auth.uid())
);

CREATE POLICY "Users can delete order exclusions for accessible locations"
ON public.inventory_order_exclusions
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_locations ul
    WHERE ul.user_id = auth.uid()
      AND ul.location_id = inventory_order_exclusions.location_id
  )
  OR public.is_super_admin(auth.uid())
);