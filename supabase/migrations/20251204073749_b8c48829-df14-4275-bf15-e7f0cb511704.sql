-- Drop existing constraint and add new one that includes 'temperature'
ALTER TABLE checklist_items DROP CONSTRAINT IF EXISTS checklist_items_item_type_check;

ALTER TABLE checklist_items ADD CONSTRAINT checklist_items_item_type_check 
CHECK (item_type IN ('text', 'multiple_choice', 'image', 'confirmation', 'PHOTO', 'CHECKBOX', 'temperature'));