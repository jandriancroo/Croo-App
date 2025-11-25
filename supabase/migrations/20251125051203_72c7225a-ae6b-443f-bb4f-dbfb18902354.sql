-- Update check constraint to allow confirmation type
ALTER TABLE checklist_items DROP CONSTRAINT IF EXISTS checklist_items_item_type_check;

ALTER TABLE checklist_items ADD CONSTRAINT checklist_items_item_type_check 
CHECK (item_type IN ('text', 'image', 'multiple_choice', 'confirmation'));