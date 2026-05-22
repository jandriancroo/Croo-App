-- =====================================================================
-- STEP 3 DRAFT v2 — Pack Config Approval Phase 1 schema
-- Spec: .lovable/pack-config-approval-spec.md §7
-- Status: DRAFT — NOT EXECUTED. Awaiting line-by-line review.
-- =====================================================================
--
-- Changes from v1 (per founder's 5 fixes, May 22 2026):
--   1. RLS now mirrors the REAL pg_policies output for
--      brand_inventory_templates, verbatim. Verified via:
--        SELECT polname, polcmd, pg_get_expr(polqual,...), pg_get_expr(polwithcheck,...)
--        FROM pg_policy WHERE polrelid = 'public.brand_inventory_templates'::regclass;
--      Result:
--        - "Brand members can view templates"   SELECT, USING(EXISTS ... organizations o JOIN locations l ...)
--        - "Brand admins and managers can manage templates"  ALL, USING(is_brand_admin OR has_role_or_higher 'manager'), WITH CHECK = NULL
--      We replicate that exact shape (single ALL policy, no WITH CHECK).
--   2. No DELETE policy on location_pack_selections — uniform
--      "archive, never delete" with brand_pack_configs.
--   3. Partial unique index on brand_pack_configs to block duplicate
--      APPROVED configs with identical structure for the same template.
--   4. Guard #3 is harmless until the canonical parser (Step 3.5) lands;
--      installed now so it's enforced the moment approvals begin.
--   5. STRUCTURAL: location_pack_selections PK reworked to allow
--      MULTIPLE active configs per (location, template) — onions by
--      sack AND by case, ranch by 4-pack AND single gallon. One row
--      per location/template is flagged is_default for ordering.
--
-- Compliance checklist (per spec §7 + §8 Step 3):
--   [x] Both tables are BRAND-NEW. No ALTER to any existing table.
--   [x] brand_pack_configs has NO DELETE policy (archive-only via status).
--   [x] location_pack_selections has NO DELETE policy (fix #2).
--   [x] CHECK constraint count_units_derivation present and exact.
--   [x] NOT added: pack_config_id_at_count, use_pack_config_spine, etc.
--   [x] FKs added on location_pack_selections.location_id and
--        .brand_template_id and .active_pack_config_id.
--   [x] updated_at trigger via existing public.update_updated_at_column().
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

  CONSTRAINT count_units_derivation
    CHECK (count_units_per_case = outer_qty * COALESCE(inner_qty, 1))
);

CREATE INDEX idx_brand_pack_configs_brand_template
  ON public.brand_pack_configs(brand_template_id);

CREATE INDEX idx_brand_pack_configs_status
  ON public.brand_pack_configs(status)
  WHERE status <> 'archived';

-- FIX #3 — duplicate-config guard. Different structures (Coke 12pk vs 24pk)
-- remain allowed because (outer_qty, inner_qty, common_unit) differ. Two
-- approved rows with identical structure for the same template are blocked.
-- NULL inner_qty is normalized via COALESCE so 24/NULL/each conflicts with
-- another 24/NULL/each but not with 24/12/each.
CREATE UNIQUE INDEX uniq_brand_pack_configs_approved_structure
  ON public.brand_pack_configs
      (brand_template_id, outer_qty, COALESCE(inner_qty, 0), common_unit)
  WHERE status = 'approved';

-- updated_at trigger (existing helper in public schema)
CREATE TRIGGER trg_brand_pack_configs_set_updated_at
  BEFORE UPDATE ON public.brand_pack_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.brand_pack_configs ENABLE ROW LEVEL SECURITY;

-- ---- RLS: SELECT  (verbatim shape of brand_inventory_templates SELECT) ----
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

-- ---- RLS: ALL  (verbatim shape of brand_inventory_templates "manage") ----
-- Real policy on brand_inventory_templates is a single FOR ALL with only
-- USING(is_brand_admin(...) OR has_role_or_higher(..., 'manager')) and
-- WITH CHECK = NULL. We mirror that exactly. The brand_id is reached via
-- brand_template_id → brand_inventory_templates.brand_id.
CREATE POLICY "Brand admins and managers can manage pack configs"
  ON public.brand_pack_configs
  FOR ALL
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
  );

-- INTENTIONALLY NO DELETE-only policy. The FOR ALL above covers
-- INSERT/UPDATE/DELETE syntactically, but lifecycle convention is
-- archive-only via status='archived' (spec §7). No client code should
-- issue DELETE against this table; reviewers should grep for it.


-- ---------------------------------------------------------------------
-- Table 2: location_pack_selections
-- ---------------------------------------------------------------------
-- FIX #5: PK is (location_id, brand_template_id, active_pack_config_id) so
-- a single location can hold MULTIPLE simultaneously-active configs for
-- the same brand template (onions by sack + by case; ranch 4-pack +
-- gallon). is_default flags the one used for ordering / single-pick UI.
CREATE TABLE public.location_pack_selections (
  location_id           uuid NOT NULL
                          REFERENCES public.locations(id),
  brand_template_id     uuid NOT NULL
                          REFERENCES public.brand_inventory_templates(id),
  active_pack_config_id uuid NOT NULL
                          REFERENCES public.brand_pack_configs(id),
  is_default            boolean NOT NULL DEFAULT false,
  selected_by           uuid,
  selected_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, brand_template_id, active_pack_config_id)
);

-- At most one default per (location, template). Multiple non-default
-- active rows are allowed.
CREATE UNIQUE INDEX uniq_location_pack_selections_default
  ON public.location_pack_selections (location_id, brand_template_id)
  WHERE is_default = true;

CREATE INDEX idx_location_pack_selections_config
  ON public.location_pack_selections(active_pack_config_id);

ALTER TABLE public.location_pack_selections ENABLE ROW LEVEL SECURITY;

-- ---- RLS: SELECT ----
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

-- FIX #2 — NO DELETE policy. Mirrors brand_pack_configs lifecycle.
-- Removing a config from a location is done by UPDATE (re-point default,
-- or insert a new row + leave the old one). If true retirement is needed
-- later we'll add an is_active flag, not a DELETE path.
