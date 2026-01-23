-- Add acknowledged_at column to qr_task_reports
ALTER TABLE public.qr_task_reports
ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;