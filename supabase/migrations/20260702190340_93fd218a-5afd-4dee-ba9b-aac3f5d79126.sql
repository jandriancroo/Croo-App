
-- =============================================================
-- Sprint A: Lite inventory counts foundation
-- Isolated from all Brand-governed tables (no FK crossings)
-- =============================================================

-- 1a. Storage locations
CREATE TABLE public.lite_storage_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id  uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lite_storage_locations_unique_name
  ON public.lite_storage_locations (location_id, lower(name));
CREATE INDEX lite_storage_locations_by_location
  ON public.lite_storage_locations (location_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_storage_locations TO authenticated;
GRANT ALL ON public.lite_storage_locations TO service_role;

ALTER TABLE public.lite_storage_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY lite_storage_locations_select ON public.lite_storage_locations
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_storage_locations_insert ON public.lite_storage_locations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_storage_locations_update ON public.lite_storage_locations
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_storage_locations_delete ON public.lite_storage_locations
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

-- 1b. Attach storage to items (single-assignment, nullable)
ALTER TABLE public.lite_inventory_items
  ADD COLUMN storage_id uuid NULL
    REFERENCES public.lite_storage_locations(id) ON DELETE SET NULL;
CREATE INDEX lite_inventory_items_by_storage
  ON public.lite_inventory_items (location_id, storage_id);

-- 1c. Count header
CREATE TABLE public.lite_inventory_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_by  uuid NULL,
  submitted_at  timestamptz NULL,
  created_by    uuid NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lite_inventory_counts_one_per_week
  ON public.lite_inventory_counts (location_id, period_end);
CREATE INDEX lite_inventory_counts_by_location
  ON public.lite_inventory_counts (location_id, period_end DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_inventory_counts TO authenticated;
GRANT ALL ON public.lite_inventory_counts TO service_role;

ALTER TABLE public.lite_inventory_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY lite_inventory_counts_select ON public.lite_inventory_counts
  FOR SELECT TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_inventory_counts_insert ON public.lite_inventory_counts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_inventory_counts_update ON public.lite_inventory_counts
  FOR UPDATE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id))
  WITH CHECK (public.has_location_access(auth.uid(), location_id));
CREATE POLICY lite_inventory_counts_delete ON public.lite_inventory_counts
  FOR DELETE TO authenticated
  USING (public.has_location_access(auth.uid(), location_id));

-- 1d. Count line items (snapshots)
CREATE TABLE public.lite_inventory_count_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id              uuid NOT NULL REFERENCES public.lite_inventory_counts(id) ON DELETE CASCADE,
  item_id               uuid NOT NULL REFERENCES public.lite_inventory_items(id) ON DELETE RESTRICT,
  quantity              numeric(12,3) NOT NULL DEFAULT 0,
  unit_value_at_count   numeric(12,4) NOT NULL DEFAULT 0,
  storage_id_at_count   uuid NULL,
  counted_by            uuid NULL,
  counted_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lite_inventory_count_items_one_per_item
  ON public.lite_inventory_count_items (count_id, item_id);
CREATE INDEX lite_inventory_count_items_by_storage_snapshot
  ON public.lite_inventory_count_items (count_id, storage_id_at_count);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lite_inventory_count_items TO authenticated;
GRANT ALL ON public.lite_inventory_count_items TO service_role;

ALTER TABLE public.lite_inventory_count_items ENABLE ROW LEVEL SECURITY;

-- Parent-scoped policies: user has access if they have access to the count's location
CREATE POLICY lite_inventory_count_items_select ON public.lite_inventory_count_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lite_inventory_counts c
    WHERE c.id = lite_inventory_count_items.count_id
      AND public.has_location_access(auth.uid(), c.location_id)
  ));
CREATE POLICY lite_inventory_count_items_insert ON public.lite_inventory_count_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lite_inventory_counts c
    WHERE c.id = count_id
      AND public.has_location_access(auth.uid(), c.location_id)
  ));
CREATE POLICY lite_inventory_count_items_update ON public.lite_inventory_count_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lite_inventory_counts c
    WHERE c.id = lite_inventory_count_items.count_id
      AND public.has_location_access(auth.uid(), c.location_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lite_inventory_counts c
    WHERE c.id = count_id
      AND public.has_location_access(auth.uid(), c.location_id)
  ));
CREATE POLICY lite_inventory_count_items_delete ON public.lite_inventory_count_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lite_inventory_counts c
    WHERE c.id = lite_inventory_count_items.count_id
      AND public.has_location_access(auth.uid(), c.location_id)
  ));

-- updated_at triggers (reuse existing helper)
CREATE TRIGGER trg_lite_storage_locations_updated_at
  BEFORE UPDATE ON public.lite_storage_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lite_inventory_counts_updated_at
  BEFORE UPDATE ON public.lite_inventory_counts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lite_inventory_count_items_updated_at
  BEFORE UPDATE ON public.lite_inventory_count_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
