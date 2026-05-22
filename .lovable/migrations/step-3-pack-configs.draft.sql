-- =====================================================================
-- STEP 3 DRAFT — Pack Config Approval Phase 1 schema
-- Spec: .lovable/pack-config-approval-spec.md §7
-- Status: DRAFT — NOT EXECUTED. Awaiting line-by-line review.
-- =====================================================================
--
-- Compliance checklist (per spec §7 + §8 Step 3):
--   [x] Both tables are BRAND-NEW. No ALTER to any existing table.
--   [x] brand_pack_configs has NO DELETE policy (archive-only via status).
--   [x] CHECK constraint count_units_derivation present and exact:
--         count_units_per_case = outer_qty * COALESCE(inner_qty, 1)
--   [x] NOT added: pack_config_id_at_count, use_pack_config_spine,
--                  or any other count/item column (deferred per §8).
--   [x] FKs added on location_pack_selections.location_id and
--        .brand_template_id (called out in user's three environment details).
--   [x] updated_at trigger attached to brand_pack_configs using the existing
--        public.update_updated_at_column() function already present in the DB.
--   [x] RLS mirrored from existing tables:
--         - brand_pack_configs   → mirrors brand_inventory_templates
--           (brand-scoped SELECT via location access through orgs+locations;
--            manage via is_brand_admin OR has_role_or_higher 'manager').
--           Reached via brand_template_id → brand_inventory_templates.brand_id.
--         - location_pack_selections → mirrors inventory_items
--           (location-scoped via has_location_access; writes require
--            has_role_or_higher 'manager').
--
-- Open question flagged (do NOT silently resolve):
--   • Should location_pack_selections have a DELETE policy at all? §7 is
--     silent. A wrong auto-match would normally be FIXED by UPDATE
--     (re-pointing active_pack_config_id), not DELETE. This draft includes
--     a manager-scoped DELETE for cleanup symmetry with inventory_items,
--     but it can be removed if you want strict "selection rows persist".
--     Mark this in review.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Table 1: brand_pack_configs
-- ---------------------------------------------------------------------
CREATE TABLE public.brand_pack_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_template_id     uuid NOT NULL
                          REFERENCES public.brand_inventory_templates(id),

  -- pack structure
  outer_qty             int  NOT NULL,
  outer_type            text NOT NULL,
  inner_qty             int,
  inner_type            text,

  -- common-unit spine
  common_unit           text    NOT NULL,
  count_units_per_case  numeric NOT NULL,

  label                 text,

  -- cost is per COMMON UNIT, never per pack. derived-for-display only.
  cost_per_common_unit  numeric,

  -- lifecycle (archive-only; never hard-delete)
  status                text NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed','approved','archived')),
  approved_by           uuid,
  approved_at           timestamptz,

  -- provenance
  source                text,
  source_evidence       jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- DERIVATION RULE (locked): inner_qty ALWAYS means "tracking units within
  -- one outer subdivision," typed by common_unit. Romaine 6/2LB → outer=6,
  -- inner=2(lb) → 12. Coke 24pk → outer=24, inner=NULL → 24.
  -- Cups 4/1000 → outer=4, inner=1000 → 4000.
  CONSTRAINT count_units_derivation
    CHECK (count_units_per_case = outer_qty * COALESCE(inner_qty, 1))
);

CREATE INDEX idx_brand_pack_configs_brand_template
  ON public.brand_pack_configs(brand_template_id);

CREATE INDEX idx_brand_pack_configs_status
  ON public.brand_pack_configs(status)
  WHERE status <> 'archived';

-- updated_at trigger (uses existing helper function in public schema)
CREATE TRIGGER trg_brand_pack_configs_set_updated_at
  BEFORE UPDATE ON public.brand_pack_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.brand_pack_configs ENABLE ROW LEVEL SECURITY;

-- ---- RLS: SELECT ----
-- Mirrors brand_inventory_templates "Brand members can view templates":
-- reach brand_id via brand_template_id → brand_inventory_templates.
CREATE POLICY "Brand members can view pack configs"
  ON public.brand_pack_configs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates t
      JOIN public.organizations o ON o.brand_id = t.brand_id
      JOIN public.locations     l ON l.organization_id = o.id
      WHERE t.id = brand_pack_configs.brand_template_id
        AND public.has_location_access(auth.uid(), l.id)
    )
  );

-- ---- RLS: INSERT / UPDATE ----
-- Mirrors brand_inventory_templates "Brand admins and managers can manage":
-- is_brand_admin(uid, brand_id) OR has_role_or_higher(uid, 'manager').
CREATE POLICY "Brand admins and managers can insert pack configs"
  ON public.brand_pack_configs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates t
      WHERE t.id = brand_pack_configs.brand_template_id
        AND (
          public.is_brand_admin(auth.uid(), t.brand_id)
          OR public.has_role_or_higher(auth.uid(), 'manager')
        )
    )
  );

CREATE POLICY "Brand admins and managers can update pack configs"
  ON public.brand_pack_configs
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates t
      WHERE t.id = brand_pack_configs.brand_template_id
        AND (
          public.is_brand_admin(auth.uid(), t.brand_id)
          OR public.has_role_or_higher(auth.uid(), 'manager')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brand_inventory_templates t
      WHERE t.id = brand_pack_configs.brand_template_id
        AND (
          public.is_brand_admin(auth.uid(), t.brand_id)
          OR public.has_role_or_higher(auth.uid(), 'manager')
        )
    )
  );

-- INTENTIONALLY NO DELETE POLICY on brand_pack_configs.
-- Lifecycle is archive-only via status='archived' (spec §7).


-- ---------------------------------------------------------------------
-- Table 2: location_pack_selections
-- ---------------------------------------------------------------------
CREATE TABLE public.location_pack_selections (
  location_id           uuid NOT NULL
                          REFERENCES public.locations(id),
  brand_template_id     uuid NOT NULL
                          REFERENCES public.brand_inventory_templates(id),
  active_pack_config_id uuid NOT NULL
                          REFERENCES public.brand_pack_configs(id),
  selected_by           uuid,
  selected_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, brand_template_id)
);

CREATE INDEX idx_location_pack_selections_config
  ON public.location_pack_selections(active_pack_config_id);

ALTER TABLE public.location_pack_selections ENABLE ROW LEVEL SECURITY;

-- ---- RLS: SELECT ----
-- Mirrors inventory_items location-scoping.
CREATE POLICY "Users can view pack selections at their locations"
  ON public.location_pack_selections
  FOR SELECT
  USING (public.has_location_access(auth.uid(), location_id));

-- ---- RLS: INSERT ----
CREATE POLICY "Managers can create pack selections"
  ON public.location_pack_selections
  FOR INSERT
  WITH CHECK (
    public.has_location_access(auth.uid(), location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  );

-- ---- RLS: UPDATE ----
CREATE POLICY "Managers can update pack selections"
  ON public.location_pack_selections
  FOR UPDATE
  USING (
    public.has_location_access(auth.uid(), location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  )
  WITH CHECK (
    public.has_location_access(auth.uid(), location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  );

-- ---- RLS: DELETE  (OPEN QUESTION — see header comment) ----
CREATE POLICY "Managers can delete pack selections"
  ON public.location_pack_selections
  FOR DELETE
  USING (
    public.has_location_access(auth.uid(), location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  );
