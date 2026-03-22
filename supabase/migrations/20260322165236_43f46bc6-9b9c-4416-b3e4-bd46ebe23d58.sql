
-- ============================================
-- Three-Layer Blueprint Architecture
-- Layer 2: recipe_blueprints (pure instructions)
-- ============================================

-- Recipe blueprints: structural instructions with yields
CREATE TABLE recipe_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT, -- 'BASE', 'CORE', 'MI', 'PREP', 'OTHER'
  yield_qty NUMERIC,
  yield_unit TEXT,
  produces_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  source TEXT DEFAULT 'manual', -- 'manual', 'r365_import'
  r365_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Blueprint ingredients: what goes into a blueprint
CREATE TABLE recipe_blueprint_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id UUID NOT NULL REFERENCES recipe_blueprints(id) ON DELETE CASCADE,
  ingredient_type TEXT NOT NULL DEFAULT 'vendor_item', -- 'vendor_item' or 'blueprint'
  vendor_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  sub_blueprint_id UUID REFERENCES recipe_blueprints(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updated_at trigger
CREATE TRIGGER update_recipe_blueprints_updated_at
  BEFORE UPDATE ON recipe_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE recipe_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_blueprint_ingredients ENABLE ROW LEVEL SECURITY;

-- Blueprints: location-scoped access
CREATE POLICY "Users can view blueprints at their locations"
  ON recipe_blueprints FOR SELECT TO authenticated
  USING (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can insert blueprints at their locations"
  ON recipe_blueprints FOR INSERT TO authenticated
  WITH CHECK (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can update blueprints at their locations"
  ON recipe_blueprints FOR UPDATE TO authenticated
  USING (has_location_access(auth.uid(), location_id))
  WITH CHECK (has_location_access(auth.uid(), location_id));

CREATE POLICY "Users can delete blueprints at their locations"
  ON recipe_blueprints FOR DELETE TO authenticated
  USING (has_location_access(auth.uid(), location_id));

-- Blueprint ingredients: access via parent blueprint's location
CREATE POLICY "Users can view blueprint ingredients"
  ON recipe_blueprint_ingredients FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM recipe_blueprints rb
    WHERE rb.id = blueprint_id
    AND has_location_access(auth.uid(), rb.location_id)
  ));

CREATE POLICY "Users can insert blueprint ingredients"
  ON recipe_blueprint_ingredients FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM recipe_blueprints rb
    WHERE rb.id = blueprint_id
    AND has_location_access(auth.uid(), rb.location_id)
  ));

CREATE POLICY "Users can update blueprint ingredients"
  ON recipe_blueprint_ingredients FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM recipe_blueprints rb
    WHERE rb.id = blueprint_id
    AND has_location_access(auth.uid(), rb.location_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM recipe_blueprints rb
    WHERE rb.id = blueprint_id
    AND has_location_access(auth.uid(), rb.location_id)
  ));

CREATE POLICY "Users can delete blueprint ingredients"
  ON recipe_blueprint_ingredients FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM recipe_blueprints rb
    WHERE rb.id = blueprint_id
    AND has_location_access(auth.uid(), rb.location_id)
  ));

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX idx_recipe_blueprints_location ON recipe_blueprints(location_id) WHERE is_active = true;
CREATE INDEX idx_recipe_blueprints_produces ON recipe_blueprints(produces_item_id) WHERE produces_item_id IS NOT NULL;
CREATE INDEX idx_recipe_blueprints_source ON recipe_blueprints(source);
CREATE INDEX idx_recipe_blueprint_ingredients_blueprint ON recipe_blueprint_ingredients(blueprint_id);
CREATE INDEX idx_recipe_blueprint_ingredients_vendor ON recipe_blueprint_ingredients(vendor_item_id) WHERE vendor_item_id IS NOT NULL;
CREATE INDEX idx_recipe_blueprint_ingredients_sub ON recipe_blueprint_ingredients(sub_blueprint_id) WHERE sub_blueprint_id IS NOT NULL;
