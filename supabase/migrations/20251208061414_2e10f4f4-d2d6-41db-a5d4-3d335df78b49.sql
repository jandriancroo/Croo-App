-- Fix shift_templates to require authentication (not public)
DROP POLICY IF EXISTS "Anyone can view shift templates" ON public.shift_templates;
DROP POLICY IF EXISTS "Users can view shift templates" ON public.shift_templates;

-- Authenticated users can view all templates (for cross-location starting points)
CREATE POLICY "Authenticated users can view shift templates"
ON public.shift_templates
FOR SELECT
USING (auth.role() = 'authenticated');