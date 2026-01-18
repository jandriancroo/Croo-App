-- BOM (Bill of Materials) Tables for Inventory Tracking
-- These tables map R365 ingredients to menu items for theoretical usage calculation

-- All unique ingredients from R365
CREATE TABLE public.bom_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  r365_name TEXT NOT NULL,
  category TEXT,
  clean_name TEXT,
  unit_standard TEXT,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  is_prep_item BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(location_id, r365_name)
);

-- All unique menu items/recipes from R365
CREATE TABLE public.bom_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  r365_name TEXT NOT NULL,
  category TEXT,
  clean_name TEXT,
  qubeyond_item_id TEXT,
  is_sellable BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(location_id, r365_name)
);

-- Many-to-many: ingredient → menu item with quantities
CREATE TABLE public.bom_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES public.bom_menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES public.bom_ingredients(id) ON DELETE CASCADE,
  quantity DECIMAL NOT NULL,
  unit_of_measure TEXT,
  quantity_normalized DECIMAL,
  yield_percent DECIMAL DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(location_id, menu_item_id, ingredient_id)
);

-- Enable RLS
ALTER TABLE public.bom_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_recipe_ingredients ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bom_ingredients
CREATE POLICY "Users can view bom_ingredients for their locations"
  ON public.bom_ingredients FOR SELECT
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert bom_ingredients for their locations"
  ON public.bom_ingredients FOR INSERT
  WITH CHECK (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update bom_ingredients for their locations"
  ON public.bom_ingredients FOR UPDATE
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete bom_ingredients for their locations"
  ON public.bom_ingredients FOR DELETE
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

-- RLS Policies for bom_menu_items
CREATE POLICY "Users can view bom_menu_items for their locations"
  ON public.bom_menu_items FOR SELECT
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert bom_menu_items for their locations"
  ON public.bom_menu_items FOR INSERT
  WITH CHECK (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update bom_menu_items for their locations"
  ON public.bom_menu_items FOR UPDATE
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete bom_menu_items for their locations"
  ON public.bom_menu_items FOR DELETE
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

-- RLS Policies for bom_recipe_ingredients
CREATE POLICY "Users can view bom_recipe_ingredients for their locations"
  ON public.bom_recipe_ingredients FOR SELECT
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert bom_recipe_ingredients for their locations"
  ON public.bom_recipe_ingredients FOR INSERT
  WITH CHECK (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update bom_recipe_ingredients for their locations"
  ON public.bom_recipe_ingredients FOR UPDATE
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can delete bom_recipe_ingredients for their locations"
  ON public.bom_recipe_ingredients FOR DELETE
  USING (location_id IN (
    SELECT location_id FROM public.user_locations WHERE user_id = auth.uid()
  ));

-- Indexes for performance
CREATE INDEX idx_bom_ingredients_location ON public.bom_ingredients(location_id);
CREATE INDEX idx_bom_ingredients_inventory_item ON public.bom_ingredients(inventory_item_id);
CREATE INDEX idx_bom_ingredients_category ON public.bom_ingredients(category);
CREATE INDEX idx_bom_menu_items_location ON public.bom_menu_items(location_id);
CREATE INDEX idx_bom_menu_items_qubeyond ON public.bom_menu_items(qubeyond_item_id);
CREATE INDEX idx_bom_menu_items_sellable ON public.bom_menu_items(is_sellable);
CREATE INDEX idx_bom_recipe_ingredients_menu_item ON public.bom_recipe_ingredients(menu_item_id);
CREATE INDEX idx_bom_recipe_ingredients_ingredient ON public.bom_recipe_ingredients(ingredient_id);