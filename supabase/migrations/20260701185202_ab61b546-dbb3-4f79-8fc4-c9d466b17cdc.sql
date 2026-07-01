
-- Library settings (per brand, per org)
CREATE TABLE public.library_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand_library_enabled boolean NOT NULL DEFAULT false,
  org_library_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_settings_scope_check CHECK (brand_id IS NOT NULL OR organization_id IS NOT NULL),
  CONSTRAINT library_settings_brand_unique UNIQUE (brand_id),
  CONSTRAINT library_settings_org_unique UNIQUE (organization_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_settings TO authenticated;
GRANT ALL ON public.library_settings TO service_role;
ALTER TABLE public.library_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read library settings"
ON public.library_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "brand admins manage brand library settings"
ON public.library_settings FOR ALL TO authenticated
USING (
  brand_id IS NOT NULL AND (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'brand_admin'::app_role)
  )
) WITH CHECK (
  brand_id IS NOT NULL AND (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'brand_admin'::app_role)
  )
);

CREATE POLICY "org admins manage org library settings"
ON public.library_settings FOR ALL TO authenticated
USING (
  organization_id IS NOT NULL AND (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'brand_admin'::app_role) OR
    public.has_role(auth.uid(), 'org_admin'::app_role)
  )
) WITH CHECK (
  organization_id IS NOT NULL AND (
    public.has_role(auth.uid(), 'super_admin'::app_role) OR
    public.has_role(auth.uid(), 'brand_admin'::app_role) OR
    public.has_role(auth.uid(), 'org_admin'::app_role)
  )
);

-- Ingredients repository
CREATE TABLE public.library_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('brand','org')),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX library_ingredients_brand_name_uq
  ON public.library_ingredients (brand_id, lower(name)) WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX library_ingredients_org_name_uq
  ON public.library_ingredients (organization_id, lower(name)) WHERE organization_id IS NOT NULL;
CREATE INDEX library_ingredients_name_trgm ON public.library_ingredients USING gin (name gin_trgm_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_ingredients TO authenticated;
GRANT ALL ON public.library_ingredients TO service_role;
ALTER TABLE public.library_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read ingredients" ON public.library_ingredients
FOR SELECT TO authenticated USING (true);

CREATE POLICY "brand admins manage brand ingredients" ON public.library_ingredients
FOR ALL TO authenticated
USING (scope = 'brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role)))
WITH CHECK (scope = 'brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role)));

CREATE POLICY "org admins manage org ingredients" ON public.library_ingredients
FOR ALL TO authenticated
USING (scope = 'org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)))
WITH CHECK (scope = 'org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)));

-- Documents / recipes
CREATE TABLE public.library_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('brand','org')),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('recipe','document')),
  title text NOT NULL,
  description text,
  body jsonb,
  steps jsonb,
  photo_url text,
  file_url text,
  file_type text,
  tags text[] NOT NULL DEFAULT '{}',
  category text,
  search_tsv tsvector,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_documents_scope_idx ON public.library_documents (scope, brand_id, organization_id);
CREATE INDEX library_documents_tsv_idx ON public.library_documents USING gin (search_tsv);
CREATE INDEX library_documents_tags_idx ON public.library_documents USING gin (tags);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_documents TO authenticated;
GRANT ALL ON public.library_documents TO service_role;
ALTER TABLE public.library_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read documents" ON public.library_documents
FOR SELECT TO authenticated USING (true);

CREATE POLICY "brand admins manage brand documents" ON public.library_documents
FOR ALL TO authenticated
USING (scope = 'brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role)))
WITH CHECK (scope = 'brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role)));

CREATE POLICY "org admins manage org documents" ON public.library_documents
FOR ALL TO authenticated
USING (scope = 'org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)))
WITH CHECK (scope = 'org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)));

-- Recipe ingredients (join)
CREATE TABLE public.library_recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.library_documents(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.library_ingredients(id) ON DELETE RESTRICT,
  quantity numeric,
  unit text,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_recipe_ingredients_recipe_idx ON public.library_recipe_ingredients (recipe_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_recipe_ingredients TO authenticated;
GRANT ALL ON public.library_recipe_ingredients TO service_role;
ALTER TABLE public.library_recipe_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read recipe ingredients" ON public.library_recipe_ingredients
FOR SELECT TO authenticated USING (true);

CREATE POLICY "editors manage recipe ingredients" ON public.library_recipe_ingredients
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.library_documents d
  WHERE d.id = recipe_id AND (
    (d.scope='brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role))) OR
    (d.scope='org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)))
  )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.library_documents d
  WHERE d.id = recipe_id AND (
    (d.scope='brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role))) OR
    (d.scope='org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)))
  )
));

-- Recipe cross-links
CREATE TABLE public.library_recipe_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_recipe_id uuid NOT NULL REFERENCES public.library_documents(id) ON DELETE CASCADE,
  to_recipe_id uuid NOT NULL REFERENCES public.library_documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_recipe_id, to_recipe_id)
);
CREATE INDEX library_recipe_links_from_idx ON public.library_recipe_links (from_recipe_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_recipe_links TO authenticated;
GRANT ALL ON public.library_recipe_links TO service_role;
ALTER TABLE public.library_recipe_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read recipe links" ON public.library_recipe_links
FOR SELECT TO authenticated USING (true);

CREATE POLICY "editors manage recipe links" ON public.library_recipe_links
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.library_documents d
  WHERE d.id = from_recipe_id AND (
    (d.scope='brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role))) OR
    (d.scope='org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)))
  )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.library_documents d
  WHERE d.id = from_recipe_id AND (
    (d.scope='brand' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role))) OR
    (d.scope='org' AND (public.has_role(auth.uid(),'super_admin'::app_role) OR public.has_role(auth.uid(),'brand_admin'::app_role) OR public.has_role(auth.uid(),'org_admin'::app_role)))
  )
));

-- Search tsvector trigger
CREATE OR REPLACE FUNCTION public.library_documents_tsv_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ing_text text;
BEGIN
  SELECT string_agg(li.name, ' ') INTO ing_text
  FROM public.library_recipe_ingredients lri
  JOIN public.library_ingredients li ON li.id = lri.ingredient_id
  WHERE lri.recipe_id = NEW.id;

  NEW.search_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.category,'')), 'C') ||
    setweight(to_tsvector('english', coalesce(ing_text,'')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.body::text,'')), 'D') ||
    setweight(to_tsvector('english', coalesce(NEW.steps::text,'')), 'D');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER library_documents_tsv_trg
BEFORE INSERT OR UPDATE ON public.library_documents
FOR EACH ROW EXECUTE FUNCTION public.library_documents_tsv_update();

-- Reindex parent recipe when ingredients change
CREATE OR REPLACE FUNCTION public.library_recipe_ingredients_reindex()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rid uuid;
BEGIN
  rid := COALESCE(NEW.recipe_id, OLD.recipe_id);
  UPDATE public.library_documents SET updated_at = now() WHERE id = rid;
  RETURN NULL;
END;
$$;

CREATE TRIGGER library_recipe_ingredients_reindex_trg
AFTER INSERT OR UPDATE OR DELETE ON public.library_recipe_ingredients
FOR EACH ROW EXECUTE FUNCTION public.library_recipe_ingredients_reindex();

-- Ensure trigram extension for ingredient search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
