-- 1. Columns
ALTER TABLE public.inventory_counts
  ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sandbox_owner uuid NULL;

-- Integrity: sandbox_owner must be set iff is_sandbox is true
ALTER TABLE public.inventory_counts
  DROP CONSTRAINT IF EXISTS inventory_counts_sandbox_owner_consistency;
ALTER TABLE public.inventory_counts
  ADD CONSTRAINT inventory_counts_sandbox_owner_consistency
  CHECK (
    (is_sandbox = false AND sandbox_owner IS NULL)
    OR (is_sandbox = true AND sandbox_owner IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_inventory_counts_sandbox_owner
  ON public.inventory_counts (sandbox_owner)
  WHERE is_sandbox = true;

-- 2. Replace inventory_counts RLS with sandbox-aware versions
DROP POLICY IF EXISTS "Users can view inventory counts at their location"   ON public.inventory_counts;
DROP POLICY IF EXISTS "Users can create inventory counts"                   ON public.inventory_counts;
DROP POLICY IF EXISTS "Users can update inventory counts at their location" ON public.inventory_counts;
DROP POLICY IF EXISTS "Users can delete inventory counts at their location" ON public.inventory_counts;

CREATE POLICY "Users can view inventory counts at their location"
  ON public.inventory_counts FOR SELECT
  USING (
    (is_sandbox = false AND has_location_access(auth.uid(), location_id))
    OR (
      is_sandbox = true
      AND sandbox_owner = auth.uid()
      AND public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

CREATE POLICY "Users can create inventory counts"
  ON public.inventory_counts FOR INSERT
  WITH CHECK (
    (is_sandbox = false AND has_location_access(auth.uid(), location_id))
    OR (
      is_sandbox = true
      AND sandbox_owner = auth.uid()
      AND public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

CREATE POLICY "Users can update inventory counts at their location"
  ON public.inventory_counts FOR UPDATE
  USING (
    (is_sandbox = false AND has_location_access(auth.uid(), location_id))
    OR (
      is_sandbox = true
      AND sandbox_owner = auth.uid()
      AND public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  )
  WITH CHECK (
    (is_sandbox = false AND has_location_access(auth.uid(), location_id))
    OR (
      is_sandbox = true
      AND sandbox_owner = auth.uid()
      AND public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

CREATE POLICY "Users can delete inventory counts at their location"
  ON public.inventory_counts FOR DELETE
  USING (
    (is_sandbox = false AND has_location_access(auth.uid(), location_id))
    OR (
      is_sandbox = true
      AND sandbox_owner = auth.uid()
      AND public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- 3. Extend inventory_count_items RLS to honor sandbox ownership
DROP POLICY IF EXISTS "Users can manage count items for their counts"            ON public.inventory_count_items;
DROP POLICY IF EXISTS "Users can delete inventory count items at their location" ON public.inventory_count_items;

CREATE POLICY "Users can manage count items for their counts"
  ON public.inventory_count_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_counts ic
      WHERE ic.id = inventory_count_items.count_id
        AND (
          (ic.is_sandbox = false AND has_location_access(auth.uid(), ic.location_id))
          OR (ic.is_sandbox = true AND ic.sandbox_owner = auth.uid()
              AND public.has_role(auth.uid(), 'super_admin'::app_role))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.inventory_counts ic
      WHERE ic.id = inventory_count_items.count_id
        AND (
          (ic.is_sandbox = false AND has_location_access(auth.uid(), ic.location_id))
          OR (ic.is_sandbox = true AND ic.sandbox_owner = auth.uid()
              AND public.has_role(auth.uid(), 'super_admin'::app_role))
        )
    )
  );

CREATE POLICY "Users can delete inventory count items at their location"
  ON public.inventory_count_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.inventory_counts ic
      WHERE ic.id = inventory_count_items.count_id
        AND (
          (ic.is_sandbox = false AND has_location_access(auth.uid(), ic.location_id))
          OR (ic.is_sandbox = true AND ic.sandbox_owner = auth.uid()
              AND public.has_role(auth.uid(), 'super_admin'::app_role))
        )
    )
  );

-- 4. Aggregation-safe view
CREATE OR REPLACE VIEW public.inventory_counts_live
WITH (security_invoker = true)
AS
  SELECT * FROM public.inventory_counts WHERE is_sandbox = false;

GRANT SELECT ON public.inventory_counts_live TO authenticated, service_role;