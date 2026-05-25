
ALTER TABLE public.plans
  ADD COLUMN feature_bullets TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.plans SET feature_bullets = ARRAY[
  'Checklists & Tasks',
  'Team Chat',
  'Basic Scheduling (CRUD/Templates)'
] WHERE key = 'core' AND catalog_id IN (SELECT id FROM public.plan_catalogs WHERE brand_id IS NULL);

UPDATE public.plans SET feature_bullets = ARRAY[
  'Everything in Core',
  'Punch Clock & Time Tracking',
  'Sales & Labor Dashboards',
  'Logbook',
  'Availability Management',
  'POS & KDS Integrations'
] WHERE key = 'pro' AND catalog_id IN (SELECT id FROM public.plan_catalogs WHERE brand_id IS NULL);

UPDATE public.plans SET feature_bullets = ARRAY[
  'Everything in Pro',
  'Inventory Management',
  'Hiring Module',
  'PFG & Produce Alliance Integrations'
] WHERE key = 'ludicrous' AND catalog_id IN (SELECT id FROM public.plan_catalogs WHERE brand_id IS NULL);

UPDATE public.plans SET feature_bullets = ARRAY[
  'Everything in Ludicrous',
  'Locked-in $99/mo rate',
  'Priority support'
] WHERE key = 'founder' AND catalog_id IN (SELECT id FROM public.plan_catalogs WHERE brand_id IS NULL);
