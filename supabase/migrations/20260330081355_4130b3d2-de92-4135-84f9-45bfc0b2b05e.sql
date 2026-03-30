
CREATE TABLE public.brand_inventory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);

ALTER TABLE public.brand_inventory_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read brand inventory categories"
  ON public.brand_inventory_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Brand members can manage categories"
  ON public.brand_inventory_categories FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = brand_inventory_categories.brand_id
      AND bm.user_id = auth.uid()
    )
  );

-- Seed with current categories from the brand
INSERT INTO public.brand_inventory_categories (brand_id, name, display_order)
VALUES
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Dough', 0),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Sauce', 1),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Cheese', 2),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Meat', 3),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Veggie', 4),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Condiments', 5),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Desserts', 6),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Dry Goods', 7),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Beverages', 8),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Paper Goods', 9),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Cleaning', 10),
  ('5f805404-cc7b-454b-a994-fe5901c32e6a', 'Other', 11);
