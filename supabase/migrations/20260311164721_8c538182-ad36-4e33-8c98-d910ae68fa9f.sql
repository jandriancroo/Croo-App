
-- Universal BOM import pipeline
-- Supports R365, future brand exports, any recipe/ingredient source

-- Import batch: one per CSV upload session
CREATE TABLE public.bom_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'r365', -- 'r365', 'toast', 'custom', etc.
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'reviewing', 'approved', 'rejected', 'partial'
  uploaded_by UUID REFERENCES public.profiles(id) NOT NULL,
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  raw_csv_url TEXT, -- optional storage reference
  file_name TEXT,
  summary JSONB DEFAULT '{}'::jsonb, -- { new: 5, updated: 3, removed: 1, unchanged: 42 }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual diff items within a batch
CREATE TABLE public.bom_import_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES public.bom_import_batches(id) ON DELETE CASCADE NOT NULL,
  entity_type TEXT NOT NULL, -- 'ingredient', 'menu_item', 'recipe_link'
  change_type TEXT NOT NULL, -- 'new', 'updated', 'removed', 'unchanged'
  r365_name TEXT NOT NULL,
  category TEXT,
  -- For ingredients
  clean_name TEXT,
  unit_standard TEXT,
  is_prep_item BOOLEAN DEFAULT false,
  -- For menu items
  is_sellable BOOLEAN,
  -- For recipe links
  parent_r365_name TEXT, -- the menu item this ingredient belongs to
  quantity NUMERIC,
  unit_of_measure TEXT,
  yield_percent NUMERIC,
  -- Diff details
  previous_values JSONB, -- snapshot of what existed before
  new_values JSONB, -- what the CSV says
  -- Resolution
  resolution TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'skipped'
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bom_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_import_items ENABLE ROW LEVEL SECURITY;

-- RLS: location-scoped access
CREATE POLICY "Users can view import batches for their locations"
  ON public.bom_import_batches FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can insert import batches for their locations"
  ON public.bom_import_batches FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update import batches for their locations"
  ON public.bom_import_batches FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can view import items via batch access"
  ON public.bom_import_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bom_import_batches b 
    WHERE b.id = batch_id 
    AND public.has_location_access(auth.uid(), b.location_id)
  ));

CREATE POLICY "Users can insert import items via batch access"
  ON public.bom_import_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bom_import_batches b 
    WHERE b.id = batch_id 
    AND public.has_location_access(auth.uid(), b.location_id)
  ));

CREATE POLICY "Users can update import items via batch access"
  ON public.bom_import_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bom_import_batches b 
    WHERE b.id = batch_id 
    AND public.has_location_access(auth.uid(), b.location_id)
  ));

-- Indexes for performance
CREATE INDEX idx_bom_import_batches_location ON public.bom_import_batches(location_id);
CREATE INDEX idx_bom_import_batches_status ON public.bom_import_batches(status);
CREATE INDEX idx_bom_import_items_batch ON public.bom_import_items(batch_id);
CREATE INDEX idx_bom_import_items_change_type ON public.bom_import_items(change_type);

-- Updated_at trigger
CREATE TRIGGER update_bom_import_batches_updated_at
  BEFORE UPDATE ON public.bom_import_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
