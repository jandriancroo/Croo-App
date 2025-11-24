-- Add table to track schedule changes for notifications
CREATE TABLE IF NOT EXISTS schedule_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  change_type text NOT NULL CHECK (change_type IN ('added', 'removed', 'time_changed', 'date_changed')),
  old_shift_data jsonb,
  new_shift_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE schedule_change_log ENABLE ROW LEVEL SECURITY;

-- Users can view their own change logs
CREATE POLICY "Users can view own change logs"
ON schedule_change_log FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins and managers can manage change logs
CREATE POLICY "Admins and managers can manage change logs"
ON schedule_change_log FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

-- Add snapshot column to schedules to store state when published
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS published_snapshot jsonb;

-- Create index for change logs
CREATE INDEX IF NOT EXISTS idx_schedule_change_log_schedule_id ON schedule_change_log(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_change_log_user_id ON schedule_change_log(user_id);