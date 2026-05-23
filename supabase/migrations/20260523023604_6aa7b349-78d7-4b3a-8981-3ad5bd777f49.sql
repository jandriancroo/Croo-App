
-- Audit log for the pack-config seeder (mirrors snapshot_backfill_log shape)
CREATE TABLE public.pack_config_seed_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_template_id     uuid REFERENCES public.brand_inventory_templates(id),
  vendor                text,
  vendor_item_id        text,
  pack_string           text,
  outer_qty             int,
  inner_qty             int,
  inner_type            text,
  common_unit           text,
  count_units_per_case  numeric,
  cost_per_common_unit  numeric,
  existing_config_id    uuid REFERENCES public.brand_pack_configs(id),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('matched','diff','orphan','created','skipped')),
  dry_run               boolean NOT NULL DEFAULT false,
  run_id                text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pack_config_seed_log_run
  ON public.pack_config_seed_log(run_id);

CREATE INDEX idx_pack_config_seed_log_template
  ON public.pack_config_seed_log(brand_template_id);

CREATE INDEX idx_pack_config_seed_log_status
  ON public.pack_config_seed_log(status);
