-- Make completed_by nullable to allow "Store" completions (null = Store)
ALTER TABLE public.alarm_task_completions 
ALTER COLUMN completed_by DROP NOT NULL;