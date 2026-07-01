
ALTER TABLE public.library_documents
  ADD COLUMN IF NOT EXISTS yield_qty numeric,
  ADD COLUMN IF NOT EXISTS yield_unit text,
  ADD COLUMN IF NOT EXISTS servings integer,
  ADD COLUMN IF NOT EXISTS prep_time_min integer,
  ADD COLUMN IF NOT EXISTS cook_time_min integer,
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS step_photos jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.library_recipe_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.library_documents(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipe_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.library_recipe_favorites TO authenticated;
GRANT ALL ON public.library_recipe_favorites TO service_role;

ALTER TABLE public.library_recipe_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own favorites read"
  ON public.library_recipe_favorites FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own favorites write"
  ON public.library_recipe_favorites FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own favorites delete"
  ON public.library_recipe_favorites FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_library_fav_user ON public.library_recipe_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_library_fav_recipe ON public.library_recipe_favorites(recipe_id);
