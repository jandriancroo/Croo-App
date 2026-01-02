-- Create inventory storage locations table
CREATE TABLE public.inventory_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create inventory items table
CREATE TABLE public.inventory_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  storage_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'each',
  par_level NUMERIC,
  cost_per_unit NUMERIC,
  qubeyond_item_id TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create inventory counts table (each count session)
CREATE TABLE public.inventory_counts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  counted_by UUID REFERENCES public.profiles(id),
  count_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create inventory count items (individual item counts)
CREATE TABLE public.inventory_count_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_id UUID REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  theoretical_quantity NUMERIC,
  variance NUMERIC,
  variance_cost NUMERIC,
  counted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(count_id, item_id)
);

-- Enable RLS
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for inventory_locations
CREATE POLICY "Users can view inventory locations at their location" 
ON public.inventory_locations FOR SELECT 
USING (
  location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Managers can manage inventory locations" 
ON public.inventory_locations FOR ALL 
USING (
  location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid() AND role IN ('manager', 'admin', 'owner')
  )
);

-- RLS policies for inventory_items
CREATE POLICY "Users can view inventory items at their location" 
ON public.inventory_items FOR SELECT 
USING (
  location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Managers can manage inventory items" 
ON public.inventory_items FOR ALL 
USING (
  location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid() AND role IN ('manager', 'admin', 'owner')
  )
);

-- RLS policies for inventory_counts
CREATE POLICY "Users can view inventory counts at their location" 
ON public.inventory_counts FOR SELECT 
USING (
  location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can create inventory counts" 
ON public.inventory_counts FOR INSERT 
WITH CHECK (
  location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can update their own counts" 
ON public.inventory_counts FOR UPDATE 
USING (
  counted_by = auth.uid() OR
  location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid() AND role IN ('manager', 'admin', 'owner')
  )
);

-- RLS policies for inventory_count_items
CREATE POLICY "Users can view count items for counts they can see" 
ON public.inventory_count_items FOR SELECT 
USING (
  count_id IN (
    SELECT id FROM public.inventory_counts WHERE location_id IN (
      SELECT location_id FROM public.profiles WHERE id = auth.uid()
    )
  )
);

CREATE POLICY "Users can manage count items for their counts" 
ON public.inventory_count_items FOR ALL 
USING (
  count_id IN (
    SELECT id FROM public.inventory_counts WHERE counted_by = auth.uid() OR location_id IN (
      SELECT location_id FROM public.profiles WHERE id = auth.uid() AND role IN ('manager', 'admin', 'owner')
    )
  )
);

-- Add indexes for performance
CREATE INDEX idx_inventory_items_location ON public.inventory_items(location_id);
CREATE INDEX idx_inventory_items_storage ON public.inventory_items(storage_location_id);
CREATE INDEX idx_inventory_counts_location ON public.inventory_counts(location_id);
CREATE INDEX idx_inventory_counts_date ON public.inventory_counts(count_date);
CREATE INDEX idx_inventory_count_items_count ON public.inventory_count_items(count_id);