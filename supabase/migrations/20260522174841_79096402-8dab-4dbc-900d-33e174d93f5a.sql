-- =====================================================================
-- STEP 3 — Pack Config Approval Phase 1 schema
-- Spec: .lovable/pack-config-approval-spec.md §7
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table 1: brand_pack_configs
-- ---------------------------------------------------------------------
CREATE TABLE public.brand_pack_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_template_id     uuid NOT NULL
                          REFERENCES public.brand_inventory_templates(id),
  outer_qty             int  NOT NULL,
  outer_type            text NOT NULL,
  inner_qty             int,
  inner_type            text,
  common_unit           text    NOT NULL,
  count_units_per_case  numeric NOT NULL,
  label                 text,
  cost_per_common_unit  numeric,
  status                text NOT NULL DEFAULT 'proposed'
                          CHECK (status IN ('proposed','approved','archived')),
  approved_by           uuid,
  approved_at           timestamptz,
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

CREATE UNIQUE INDEX uniq_brand_pack_configs_approved_structure
  ON public.brand_pack_configs
      (brand_template_id, outer_qty, COALESCE(inner_qty, 0), common_unit)
  WHERE status = 'approved';

CREATE TRIGGER trg_brand_pack_configs_set_updated_at
  BEFORE UPDATE ON public.brand_pack_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.brand_pack_configs ENABLE ROW LEVEL SECURITY;

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

-- NO DELETE POLICY — intentional. Belt-and-suspenders REVOKE below.
REVOKE DELETE ON public.brand_pack_configs FROM service_role, authenticated, anon;


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
  is_default            boolean NOT NULL DEFAULT false,
  selected_by           uuid,
  selected_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, brand_template_id, active_pack_config_id)
);

CREATE UNIQUE INDEX uniq_location_pack_selections_default
  ON public.location_pack_selections (location_id, brand_template_id)
  WHERE is_default = true;

CREATE INDEX idx_location_pack_selections_config
  ON public.location_pack_selections(active_pack_config_id);

ALTER TABLE public.location_pack_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pack selections at their locations"
  ON public.location_pack_selections
  FOR SELECT
  USING (public.has_location_access(auth.uid(), location_id));

CREATE POLICY "Managers can create pack selections"
  ON public.location_pack_selections
  FOR INSERT
  WITH CHECK (
    public.has_location_access(auth.uid(), location_id)
    AND public.has_role_or_higher(auth.uid(), 'manager')
  );

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

-- NO DELETE POLICY — intentional. Belt-and-suspenders REVOKE below.
REVOKE DELETE ON public.location_pack_selections FROM service_role, authenticated, anon;
