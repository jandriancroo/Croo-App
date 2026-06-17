UPDATE public.location_integrations
SET backfill_status = 'pending',
    backfill_days_completed = 0,
    backfill_error = NULL,
    backfill_started_at = NULL,
    backfill_completed_at = NULL
WHERE location_id IN (
  '32379593-8255-427b-8ebf-96502f69ca8f',
  '2d309714-f808-4c98-b612-10909e569fac'
)
AND integration_type = 'qubeyond';