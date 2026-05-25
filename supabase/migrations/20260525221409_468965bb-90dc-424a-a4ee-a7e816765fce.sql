
-- =========================================================
-- Plan catalog system (Step 1) — zero-impact groundwork
-- =========================================================

CREATE TABLE public.plan_capabilities_lookup (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.plan_capabilities_lookup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read capabilities" ON public.plan_capabilities_lookup
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "super admin manage capabilities" ON public.plan_capabilities_lookup
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.plan_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plan_catalogs_brand_unique
  ON public.plan_catalogs (brand_id) WHERE brand_id IS NOT NULL;
CREATE UNIQUE INDEX plan_catalogs_global_default_unique
  ON public.plan_catalogs ((brand_id IS NULL)) WHERE brand_id IS NULL;
ALTER TABLE public.plan_catalogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read catalogs" ON public.plan_catalogs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "super admin manage catalogs" ON public.plan_catalogs
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id UUID NOT NULL REFERENCES public.plan_catalogs(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  stripe_price_id TEXT,
  stripe_product_id TEXT,
  badge_label TEXT,
  badge_style TEXT,
  icon_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  tier_rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (catalog_id, key)
);
CREATE INDEX plans_stripe_product_id_idx ON public.plans (stripe_product_id);
CREATE INDEX plans_catalog_id_idx ON public.plans (catalog_id);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read plans" ON public.plans
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "super admin manage plans" ON public.plans
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.plan_capability_grants (
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  capability_key TEXT NOT NULL REFERENCES public.plan_capabilities_lookup(key) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, capability_key)
);
ALTER TABLE public.plan_capability_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read capability grants" ON public.plan_capability_grants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "super admin manage capability grants" ON public.plan_capability_grants
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.location_plan_overrides (
  location_id UUID PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  forced_plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  is_hidden_from_chooser BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.location_plan_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read location plan overrides" ON public.location_plan_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "super admin manage location plan overrides" ON public.location_plan_overrides
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_plans_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER plan_catalogs_set_updated_at
  BEFORE UPDATE ON public.plan_catalogs
  FOR EACH ROW EXECUTE FUNCTION public.tg_plans_set_updated_at();
CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_plans_set_updated_at();
CREATE TRIGGER location_plan_overrides_set_updated_at
  BEFORE UPDATE ON public.location_plan_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_plans_set_updated_at();

-- SEED capabilities
INSERT INTO public.plan_capabilities_lookup (key, label, description, sort_order) VALUES
  ('checklists',       'Checklists & Tasks',           'Daily / shift checklists and task assignment',     10),
  ('chat',             'Team Chat',                    'Real-time team chat',                              20),
  ('schedule_basic',   'Basic Scheduling',             'Schedule CRUD and templates',                      30),
  ('punch_clock',      'Punch Clock & Time Tracking',  'Clock in/out, timecards, payroll exports',         40),
  ('sales_labor',      'Sales & Labor Dashboards',     'Live sales pacing, labor variance, projections',   50),
  ('logbook',          'Logbook',                      'Manager logbook, performance reviews, waste log',  60),
  ('availability',     'Availability Management',      'Time-off requests and availability windows',       70),
  ('pos_integration',  'POS Integration',              'QU POS sync (sales, mix, payments)',               80),
  ('kds',              'KDS',                          'Kitchen display system',                           90),
  ('inventory',        'Inventory Management',         'Counting, AvT, vendor mappings, recipes',         100),
  ('hiring',           'Hiring Module',                'Applicants, jobs feed, hiring chat',              110),
  ('pfg',              'PFG Integration',              'Performance Food Group sync',                     120),
  ('produce_alliance', 'Produce Alliance Integration', 'Produce Alliance sync',                           130);

-- SEED global default catalog mirroring subscriptionTiers.ts
WITH cat AS (
  INSERT INTO public.plan_catalogs (brand_id, name)
  VALUES (NULL, 'Global Default')
  RETURNING id
), inserted_plans AS (
  INSERT INTO public.plans
    (catalog_id, key, display_name, description, price_cents, currency,
     stripe_price_id, stripe_product_id, badge_label, badge_style, icon_key,
     sort_order, is_visible, tier_rank)
  SELECT cat.id, v.key, v.display_name, v.description, v.price_cents, 'usd',
         v.stripe_price_id, v.stripe_product_id, v.badge_label, v.badge_style, v.icon_key,
         v.sort_order, true, v.tier_rank
  FROM cat,
  (VALUES
    ('core',      'Core',      'Checklists, Tasks, Chat, and Basic Scheduling',
       4900, 'price_1T610tCmnsCrRQe0PLjgsDMd', 'prod_U49JcuSK6gmwbv',
       NULL,                     NULL,      'zap',    10, 1),
    ('pro',       'Pro',       'Core plus operational tools',
       9900, 'price_1T610rCmnsCrRQe016bX9T68', 'prod_U49JpyY8YpSpZP',
       'Most Popular',           'primary', 'rocket', 20, 2),
    ('ludicrous', 'Ludicrous', 'Pro plus Inventory and Hiring',
      15900, 'price_1T610wCmnsCrRQe0TcPDTjJy', 'prod_U49J9N7epjx3ZR',
       'Industry''s Best Value', 'primary', 'star',   30, 3),
    ('founder',   'Founder',   'Full Ludicrous features at a locked-in early adopter rate',
       9900, 'price_1T610wCmnsCrRQe007Lt1DIq', 'prod_U49JvCB8e49mts',
       'Exclusive',              'founder', 'crown',  40, 3)
  ) AS v(key, display_name, description, price_cents,
         stripe_price_id, stripe_product_id, badge_label, badge_style, icon_key,
         sort_order, tier_rank)
  RETURNING id, key
)
INSERT INTO public.plan_capability_grants (plan_id, capability_key)
SELECT p.id, c.cap
FROM inserted_plans p
JOIN LATERAL (
  SELECT unnest(CASE p.key
    WHEN 'core' THEN ARRAY['checklists','chat','schedule_basic']
    WHEN 'pro'  THEN ARRAY['checklists','chat','schedule_basic','punch_clock','sales_labor','logbook','availability','pos_integration','kds']
    WHEN 'ludicrous' THEN ARRAY['checklists','chat','schedule_basic','punch_clock','sales_labor','logbook','availability','pos_integration','kds','inventory','hiring','pfg','produce_alliance']
    WHEN 'founder'   THEN ARRAY['checklists','chat','schedule_basic','punch_clock','sales_labor','logbook','availability','pos_integration','kds','inventory','hiring','pfg','produce_alliance']
  END) AS cap
) c ON true;
