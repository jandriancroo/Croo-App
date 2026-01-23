-- Add additional QR task columns
ALTER TABLE public.temporary_tasks
ADD COLUMN IF NOT EXISTS qr_allow_notes boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS qr_notify_punch_clock boolean DEFAULT true;