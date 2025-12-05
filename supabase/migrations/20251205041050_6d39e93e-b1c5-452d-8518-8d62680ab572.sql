-- Add follow-up tracking fields to logbook_entries
ALTER TABLE public.logbook_entries 
ADD COLUMN IF NOT EXISTS followup_completed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS followup_completed_by uuid REFERENCES auth.users(id);

-- Add comment for clarity
COMMENT ON COLUMN public.logbook_entries.followup_completed_at IS 'Timestamp when follow-up action (Redeem/Refund) was completed';
COMMENT ON COLUMN public.logbook_entries.followup_completed_by IS 'User who completed the follow-up action';