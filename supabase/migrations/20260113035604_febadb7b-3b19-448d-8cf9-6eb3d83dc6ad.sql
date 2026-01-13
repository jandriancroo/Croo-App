-- Create employee writeup reasons table (customizable per location)
CREATE TABLE public.employee_writeup_reasons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_writeup_reasons ENABLE ROW LEVEL SECURITY;

-- Policies for writeup reasons
CREATE POLICY "Users can view writeup reasons for their location"
  ON public.employee_writeup_reasons FOR SELECT
  USING (location_id IN (
    SELECT location_id FROM public.profiles WHERE id = auth.uid()
    UNION
    SELECT id FROM public.locations WHERE organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  ));

CREATE POLICY "Managers can manage writeup reasons"
  ON public.employee_writeup_reasons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() 
      AND role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'general_manager', 'manager')
    )
  );

-- Create employee writeups table
CREATE TABLE public.employee_writeups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  next_steps TEXT NOT NULL,
  photo_url TEXT,
  signature_url TEXT,
  task_id UUID REFERENCES public.temporary_tasks(id) ON DELETE SET NULL,
  viewed_at TIMESTAMP WITH TIME ZONE,
  signed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_writeups ENABLE ROW LEVEL SECURITY;

-- Policy: Managers can view all writeups for their location
CREATE POLICY "Managers can view location writeups"
  ON public.employee_writeups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() 
      AND role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'general_manager', 'manager')
    )
    AND location_id IN (
      SELECT location_id FROM public.profiles WHERE id = auth.uid()
      UNION
      SELECT id FROM public.locations WHERE organization_id IN (
        SELECT organization_id FROM public.profiles WHERE id = auth.uid()
      )
    )
  );

-- Policy: Employees can view their own writeups
CREATE POLICY "Employees can view their own writeups"
  ON public.employee_writeups FOR SELECT
  USING (employee_id = auth.uid());

-- Policy: Managers can create writeups
CREATE POLICY "Managers can create writeups"
  ON public.employee_writeups FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() 
      AND role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'general_manager', 'manager')
    )
  );

-- Policy: Employees can update their own writeups (for signing)
CREATE POLICY "Employees can sign their writeups"
  ON public.employee_writeups FOR UPDATE
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

-- Policy: Managers can update writeups they created
CREATE POLICY "Managers can update writeups"
  ON public.employee_writeups FOR UPDATE
  USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() 
      AND role IN ('super_admin', 'brand_admin', 'org_admin', 'admin', 'general_manager')
    )
  );

-- Create indexes for performance
CREATE INDEX idx_employee_writeups_location ON public.employee_writeups(location_id);
CREATE INDEX idx_employee_writeups_employee ON public.employee_writeups(employee_id);
CREATE INDEX idx_employee_writeups_created_at ON public.employee_writeups(created_at DESC);
CREATE INDEX idx_employee_writeup_reasons_location ON public.employee_writeup_reasons(location_id);

-- Add trigger for updated_at
CREATE TRIGGER update_employee_writeups_updated_at
  BEFORE UPDATE ON public.employee_writeups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();