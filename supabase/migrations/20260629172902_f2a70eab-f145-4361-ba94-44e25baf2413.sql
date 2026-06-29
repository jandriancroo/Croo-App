ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS billing_initiated_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_initiated_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS billing_initiated_email text;