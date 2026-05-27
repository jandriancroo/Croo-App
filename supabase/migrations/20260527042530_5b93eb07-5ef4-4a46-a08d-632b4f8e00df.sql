ALTER TABLE public.sales_cache
  ADD COLUMN IF NOT EXISTS pos_source TEXT NOT NULL DEFAULT 'qubeyond';

UPDATE public.sales_cache SET pos_source = 'qubeyond' WHERE pos_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_cache_pos_source ON public.sales_cache(pos_source);