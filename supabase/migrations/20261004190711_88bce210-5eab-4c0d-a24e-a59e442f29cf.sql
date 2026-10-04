ALTER TABLE public.theo_action_log ADD COLUMN IF NOT EXISTS source text;
UPDATE public.theo_action_log SET source = 'voice' WHERE source IS NULL;