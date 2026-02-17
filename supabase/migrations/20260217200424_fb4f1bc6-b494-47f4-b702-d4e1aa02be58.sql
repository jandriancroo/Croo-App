-- Remove duplicate completions, keeping only the earliest per (task_id, interval_key)
DELETE FROM alarm_task_completions
WHERE id NOT IN (
  SELECT DISTINCT ON (task_id, interval_key) id
  FROM alarm_task_completions
  ORDER BY task_id, interval_key, completed_at ASC
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE alarm_task_completions
ADD CONSTRAINT alarm_task_completions_task_interval_unique 
UNIQUE (task_id, interval_key);