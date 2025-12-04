-- Add support for multiple photos per checklist response
ALTER TABLE public.checklist_responses 
ADD COLUMN response_image_urls jsonb DEFAULT '[]'::jsonb;

-- Add comment for clarity
COMMENT ON COLUMN public.checklist_responses.response_image_urls IS 'Array of image URLs for multi-photo responses';