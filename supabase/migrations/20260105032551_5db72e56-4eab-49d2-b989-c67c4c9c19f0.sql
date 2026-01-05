-- Create table for tracking inventory count edits
CREATE TABLE public.inventory_count_edits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_item_id UUID NOT NULL REFERENCES public.inventory_count_items(id) ON DELETE CASCADE,
  edited_by UUID REFERENCES public.profiles(id),
  previous_quantity NUMERIC(10,2) NOT NULL,
  new_quantity NUMERIC(10,2) NOT NULL,
  reason TEXT,
  edited_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inventory_count_edits ENABLE ROW LEVEL SECURITY;

-- Create policy for users to view edits at their location
CREATE POLICY "Users can view edits for their location counts" 
ON public.inventory_count_edits 
FOR SELECT 
USING (
  count_item_id IN (
    SELECT ici.id FROM inventory_count_items ici
    JOIN inventory_counts ic ON ici.count_id = ic.id
    WHERE ic.location_id IN (
      SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
    )
  )
);

-- Create policy for users to insert edits
CREATE POLICY "Users can insert edits for their location counts" 
ON public.inventory_count_edits 
FOR INSERT 
WITH CHECK (
  count_item_id IN (
    SELECT ici.id FROM inventory_count_items ici
    JOIN inventory_counts ic ON ici.count_id = ic.id
    WHERE ic.location_id IN (
      SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
    )
  )
);

-- Add index for faster lookups
CREATE INDEX idx_inventory_count_edits_item ON public.inventory_count_edits(count_item_id);
CREATE INDEX idx_inventory_count_edits_time ON public.inventory_count_edits(edited_at DESC);