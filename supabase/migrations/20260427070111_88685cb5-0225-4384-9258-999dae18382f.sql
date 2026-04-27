CREATE TABLE public.inventory_count_input_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_id UUID NOT NULL,
  location_id UUID NOT NULL,
  item_id UUID NOT NULL,
  item_name TEXT,
  storage_location_id UUID,
  storage_location_name TEXT,
  entered_cases NUMERIC,
  entered_units NUMERIC,
  pan_inputs JSONB,
  pack_quantity NUMERIC,
  pan_sizes JSONB,
  computed_quantity NUMERIC,
  user_id UUID,
  user_email TEXT,
  event_type TEXT NOT NULL DEFAULT 'input',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_count_input_log_location_time ON public.inventory_count_input_log(location_id, created_at DESC);
CREATE INDEX idx_count_input_log_count ON public.inventory_count_input_log(count_id);

ALTER TABLE public.inventory_count_input_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert input logs for their locations"
ON public.inventory_count_input_log
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = inventory_count_input_log.location_id
  )
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'brand_admin')
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Users can view input logs for their locations"
ON public.inventory_count_input_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_locations ul
    WHERE ul.user_id = auth.uid() AND ul.location_id = inventory_count_input_log.location_id
  )
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'brand_admin')
  OR public.has_role(auth.uid(), 'admin')
);