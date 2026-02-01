-- Add revision tracking columns to read_and_sign_documents
ALTER TABLE public.read_and_sign_documents 
ADD COLUMN IF NOT EXISTS revised_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 0;

-- Add comment explaining the columns
COMMENT ON COLUMN public.read_and_sign_documents.revised_at IS 'Timestamp when document was last revised, triggers re-sign requirement';
COMMENT ON COLUMN public.read_and_sign_documents.revision_number IS 'Increments each time document is revised, for tracking purposes';

-- Create index for efficient querying of revised documents
CREATE INDEX IF NOT EXISTS idx_read_and_sign_documents_revised_at 
ON public.read_and_sign_documents(revised_at) 
WHERE revised_at IS NOT NULL;