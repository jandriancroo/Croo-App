-- Create pay_periods table to track open/closed status
CREATE TABLE public.pay_periods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(start_date, end_date)
);

-- Enable RLS
ALTER TABLE public.pay_periods ENABLE ROW LEVEL SECURITY;

-- Admins and managers can manage pay periods
CREATE POLICY "Admins and managers can manage pay periods"
ON public.pay_periods
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));