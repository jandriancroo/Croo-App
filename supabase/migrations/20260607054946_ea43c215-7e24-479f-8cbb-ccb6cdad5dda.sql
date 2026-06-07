
-- Sandbox-only item flags + sticky notes
CREATE TABLE public.sandbox_item_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.inventory_counts(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  sandbox_owner uuid NOT NULL,
  tag text NOT NULL DEFAULT 'other' CHECK (tag IN ('wrong_cost','wrong_pack','missing_config','wrong_unit','other')),
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (count_id, inventory_item_id)
);

CREATE INDEX idx_sandbox_item_flags_count ON public.sandbox_item_flags(count_id);
CREATE INDEX idx_sandbox_item_flags_owner ON public.sandbox_item_flags(sandbox_owner);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sandbox_item_flags TO authenticated;
GRANT ALL ON public.sandbox_item_flags TO service_role;

ALTER TABLE public.sandbox_item_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sandbox flag owner-only access"
  ON public.sandbox_item_flags
  FOR ALL
  TO authenticated
  USING (sandbox_owner = (SELECT auth.uid()) AND public.can_see_admin_locations(auth.uid()))
  WITH CHECK (sandbox_owner = (SELECT auth.uid()) AND public.can_see_admin_locations(auth.uid()));

CREATE TRIGGER update_sandbox_item_flags_updated_at
  BEFORE UPDATE ON public.sandbox_item_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
