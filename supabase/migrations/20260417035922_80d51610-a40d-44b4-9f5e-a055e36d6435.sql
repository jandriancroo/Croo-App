-- Add reported_by_locations column to track which stores reported each gap
ALTER TABLE public.vendor_gap_alerts
ADD COLUMN IF NOT EXISTS reported_by_locations jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Helpful index for the contains/overlap queries we'll do later
CREATE INDEX IF NOT EXISTS idx_vendor_gap_alerts_reported_locations
ON public.vendor_gap_alerts USING gin (reported_by_locations);