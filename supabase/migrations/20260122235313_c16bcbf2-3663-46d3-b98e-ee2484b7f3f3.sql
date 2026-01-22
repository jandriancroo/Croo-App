-- Add QR task fields to temporary_tasks
ALTER TABLE public.temporary_tasks
ADD COLUMN IF NOT EXISTS is_qr_triggered boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS qr_code text UNIQUE,
ADD COLUMN IF NOT EXISTS qr_issue_options jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS qr_allow_notes boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS qr_notify_punch_clock boolean DEFAULT true;

-- Create index for QR code lookups
CREATE INDEX IF NOT EXISTS idx_temporary_tasks_qr_code ON public.temporary_tasks(qr_code) WHERE qr_code IS NOT NULL;

-- Create QR task reports table
CREATE TABLE public.qr_task_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.temporary_tasks(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  selected_issues text[] NOT NULL DEFAULT '{}',
  guest_note text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.profiles(id),
  reporter_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qr_task_reports ENABLE ROW LEVEL SECURITY;

-- Public can INSERT reports (guest submissions)
CREATE POLICY "Anyone can submit QR task reports"
ON public.qr_task_reports
FOR INSERT
WITH CHECK (true);

-- Location members can view reports
CREATE POLICY "Location members can view QR reports"
ON public.qr_task_reports
FOR SELECT
USING (has_location_access(auth.uid(), location_id));

-- Location managers can acknowledge reports
CREATE POLICY "Managers can acknowledge QR reports"
ON public.qr_task_reports
FOR UPDATE
USING (has_location_access(auth.uid(), location_id))
WITH CHECK (has_location_access(auth.uid(), location_id));

-- Create index for polling active reports
CREATE INDEX idx_qr_task_reports_unacknowledged 
ON public.qr_task_reports(location_id, acknowledged_at) 
WHERE acknowledged_at IS NULL;

-- Enable realtime for punch clock polling
ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_task_reports;