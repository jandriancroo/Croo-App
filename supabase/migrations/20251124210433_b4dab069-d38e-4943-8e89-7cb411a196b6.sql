-- Add approval tracking to time punches
ALTER TABLE time_punches 
ADD COLUMN approved_by uuid REFERENCES profiles(id),
ADD COLUMN approved_at timestamp with time zone;

-- Create index for faster queries
CREATE INDEX idx_time_punches_approved ON time_punches(approved_by, approved_at);