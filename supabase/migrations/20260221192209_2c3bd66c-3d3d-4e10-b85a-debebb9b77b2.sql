
-- Lightweight audit log for employee write-ups
CREATE TABLE public.employee_writeup_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  writeup_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'created' or 'deleted'
  employee_id UUID NOT NULL,
  employee_name TEXT,
  location_id UUID,
  reason TEXT,
  performed_by UUID,
  performed_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_writeup_audit ENABLE ROW LEVEL SECURITY;

-- Only super_admin can view audit logs
CREATE POLICY "Super admins can view writeup audit"
  ON public.employee_writeup_audit
  FOR SELECT
  USING (public.is_super_admin(auth.uid()));

-- Index for fast lookups
CREATE INDEX idx_writeup_audit_created_at ON public.employee_writeup_audit (created_at DESC);
CREATE INDEX idx_writeup_audit_location ON public.employee_writeup_audit (location_id);

-- Trigger function to auto-log
CREATE OR REPLACE FUNCTION public.log_writeup_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_employee_name TEXT;
  v_performer_name TEXT;
  v_action TEXT;
  v_writeup RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_writeup := NEW;
    v_action := 'created';
  ELSIF TG_OP = 'DELETE' THEN
    v_writeup := OLD;
    v_action := 'deleted';
  END IF;

  SELECT full_name INTO v_employee_name FROM profiles WHERE id = v_writeup.employee_id;
  SELECT full_name INTO v_performer_name FROM profiles WHERE id = COALESCE(auth.uid(), v_writeup.created_by);

  INSERT INTO employee_writeup_audit (writeup_id, action, employee_id, employee_name, location_id, reason, performed_by, performed_by_name)
  VALUES (
    v_writeup.id,
    v_action,
    v_writeup.employee_id,
    v_employee_name,
    v_writeup.location_id,
    v_writeup.reason,
    COALESCE(auth.uid(), v_writeup.created_by),
    v_performer_name
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers
CREATE TRIGGER audit_writeup_insert
  AFTER INSERT ON public.employee_writeups
  FOR EACH ROW EXECUTE FUNCTION public.log_writeup_audit();

CREATE TRIGGER audit_writeup_delete
  AFTER DELETE ON public.employee_writeups
  FOR EACH ROW EXECUTE FUNCTION public.log_writeup_audit();
