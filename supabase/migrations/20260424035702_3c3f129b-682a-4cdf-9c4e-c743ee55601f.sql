-- Cleanup orphaned OPUS quick tasks where the integration is currently inactive.
UPDATE temporary_tasks tt
SET is_active = false, show_on_dashboard = false
WHERE tt.icon_name = 'opus_logo'
  AND tt.completed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM location_integrations li
    WHERE li.location_id = tt.location_id
      AND li.integration_type = 'opus'
      AND li.is_active = false
  );

-- Clear orphaned task_id pointers in opus_training_modules for the same locations
UPDATE opus_training_modules otm
SET task_id = NULL
WHERE EXISTS (
  SELECT 1 FROM location_integrations li
  WHERE li.location_id = otm.location_id
    AND li.integration_type = 'opus'
    AND li.is_active = false
);