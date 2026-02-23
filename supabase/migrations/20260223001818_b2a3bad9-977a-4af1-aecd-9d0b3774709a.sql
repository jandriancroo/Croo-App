
-- Junction table: inventory items can belong to multiple storage locations
CREATE TABLE public.inventory_item_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  storage_location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(item_id, storage_location_id)
);

-- Enable RLS
ALTER TABLE public.inventory_item_locations ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users with location access can view item locations"
  ON public.inventory_item_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_items ii
      WHERE ii.id = item_id
        AND public.has_location_access(auth.uid(), ii.location_id)
    )
  );

CREATE POLICY "Users with location access can insert item locations"
  ON public.inventory_item_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventory_items ii
      WHERE ii.id = item_id
        AND public.has_location_access(auth.uid(), ii.location_id)
    )
  );

CREATE POLICY "Users with location access can delete item locations"
  ON public.inventory_item_locations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_items ii
      WHERE ii.id = item_id
        AND public.has_location_access(auth.uid(), ii.location_id)
    )
  );

-- Indexes
CREATE INDEX idx_inventory_item_locations_item ON public.inventory_item_locations(item_id);
CREATE INDEX idx_inventory_item_locations_storage ON public.inventory_item_locations(storage_location_id);

-- Seed existing assignments into the junction table
INSERT INTO public.inventory_item_locations (item_id, storage_location_id)
SELECT id, storage_location_id
FROM public.inventory_items
WHERE storage_location_id IS NOT NULL
ON CONFLICT (item_id, storage_location_id) DO NOTHING;
