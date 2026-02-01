-- Add attachments column to read_and_sign_documents table
ALTER TABLE public.read_and_sign_documents
ADD COLUMN attachments jsonb DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.read_and_sign_documents.attachments IS 'Array of attachment objects with url, name, and type fields';