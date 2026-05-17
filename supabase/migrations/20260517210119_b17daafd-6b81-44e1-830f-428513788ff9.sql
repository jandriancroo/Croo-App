ALTER TABLE public.checklist_items
  DROP CONSTRAINT IF EXISTS checklist_items_item_type_check;

ALTER TABLE public.checklist_items
  ADD CONSTRAINT checklist_items_item_type_check
  CHECK (item_type = ANY (ARRAY[
    'text'::text,
    'multiple_choice'::text,
    'image'::text,
    'confirmation'::text,
    'PHOTO'::text,
    'CHECKBOX'::text,
    'temperature'::text,
    'number'::text,
    'section_header'::text
  ]));