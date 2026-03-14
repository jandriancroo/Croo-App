
-- Dedicated positions table scoped to organizations
CREATE TABLE public.organization_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE public.organization_positions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read positions in their org
CREATE POLICY "Users can read org positions"
  ON public.organization_positions
  FOR SELECT
  TO authenticated
  USING (true);

-- Admins can manage positions (RLS is permissive; app-level role checks enforce admin-only)
CREATE POLICY "Admins can insert org positions"
  ON public.organization_positions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can update org positions"
  ON public.organization_positions
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Admins can delete org positions"
  ON public.organization_positions
  FOR DELETE
  TO authenticated
  USING (true);

-- Seed existing positions from shift_templates into the new table
INSERT INTO public.organization_positions (organization_id, name)
SELECT DISTINCT l.organization_id, st.position
FROM public.shift_templates st
JOIN public.locations l ON l.id = st.location_id
WHERE st.position IS NOT NULL
  AND l.organization_id IS NOT NULL
ON CONFLICT (organization_id, name) DO NOTHING;
