-- Create changelog entries table
CREATE TABLE public.changelog_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('feature', 'fix', 'improvement', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.changelog_entries ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage changelog
CREATE POLICY "Admins can manage changelog" 
ON public.changelog_entries 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Create index for date queries
CREATE INDEX idx_changelog_entries_date ON public.changelog_entries(entry_date DESC);