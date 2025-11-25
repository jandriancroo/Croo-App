-- Add display_order column to checklists table
ALTER TABLE public.checklists 
ADD COLUMN display_order INTEGER DEFAULT 0;

-- Initialize display_order based on created_at
UPDATE public.checklists
SET display_order = subquery.row_num
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) - 1 as row_num
  FROM public.checklists
) subquery
WHERE public.checklists.id = subquery.id;