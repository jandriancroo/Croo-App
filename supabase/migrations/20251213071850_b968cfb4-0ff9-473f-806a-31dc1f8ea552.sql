ALTER TABLE public.food_safety_audits 
ADD COLUMN item_corrections jsonb DEFAULT '{}'::jsonb;