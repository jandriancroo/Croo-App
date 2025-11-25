-- Update checklist_items constraint to allow uppercase item types
ALTER TABLE public.checklist_items 
DROP CONSTRAINT IF EXISTS checklist_items_item_type_check;

ALTER TABLE public.checklist_items
ADD CONSTRAINT checklist_items_item_type_check 
CHECK (item_type IN ('TEXT', 'CHECKBOX', 'NUMBER', 'PHOTO', 'text', 'image', 'multiple_choice', 'confirmation'));