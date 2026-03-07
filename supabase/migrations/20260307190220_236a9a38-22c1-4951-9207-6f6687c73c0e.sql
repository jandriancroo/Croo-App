
-- Add bound_to_count_id to pfg_orders
ALTER TABLE public.pfg_orders 
ADD COLUMN bound_to_count_id uuid REFERENCES public.inventory_counts(id) ON DELETE SET NULL;

-- Add bound_to_count_id to pa_orders
ALTER TABLE public.pa_orders 
ADD COLUMN bound_to_count_id uuid REFERENCES public.inventory_counts(id) ON DELETE SET NULL;

-- Index for fast lookups
CREATE INDEX idx_pfg_orders_bound_to_count ON public.pfg_orders(bound_to_count_id) WHERE bound_to_count_id IS NOT NULL;
CREATE INDEX idx_pa_orders_bound_to_count ON public.pa_orders(bound_to_count_id) WHERE bound_to_count_id IS NOT NULL;
