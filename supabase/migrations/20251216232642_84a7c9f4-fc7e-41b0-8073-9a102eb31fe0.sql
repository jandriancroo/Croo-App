-- Add item_type and response_image_url columns to temporary_task_subtasks
ALTER TABLE public.temporary_task_subtasks 
ADD COLUMN item_type text NOT NULL DEFAULT 'checkbox',
ADD COLUMN response_image_url text;

-- Add constraint for valid item types
ALTER TABLE public.temporary_task_subtasks 
ADD CONSTRAINT valid_item_type CHECK (item_type IN ('checkbox', 'photo'));