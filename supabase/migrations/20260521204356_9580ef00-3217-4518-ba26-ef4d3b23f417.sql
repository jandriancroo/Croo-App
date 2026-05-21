CREATE TABLE public.snapshot_backfill_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL,
  item_id uuid NOT NULL,
  location_id uuid,
  old_pack_qty numeric,
  new_pack_qty numeric,
  old_cost numeric,
  new_cost numeric,
  source text NOT NULL DEFAULT 'null-snapshot-backfill',
  run_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshot_backfill_log_count_id ON public.snapshot_backfill_log (count_id);
CREATE INDEX idx_snapshot_backfill_log_location_id ON public.snapshot_backfill_log (location_id);
CREATE INDEX idx_snapshot_backfill_log_run_at ON public.snapshot_backfill_log (run_at DESC);

ALTER TABLE public.snapshot_backfill_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view backfill log"
ON public.snapshot_backfill_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'));
